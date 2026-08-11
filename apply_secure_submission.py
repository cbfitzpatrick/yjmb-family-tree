#!/usr/bin/env python3
"""Apply one decrypted protected YJMB update to the authoritative workbook.

v17 rules:
- Normal authenticated additions/corrections apply without an admin approval step.
- A user's VET/RAT claims change only that user's row. Reciprocal edits are a
  separate admin validation action.
- Every caller receives a cell-level before/after change set so the queue
  processor can write an encrypted, revertible changelog.
- Missing additive v17 columns are created automatically. Existing columns are
  never renamed and unrelated cells are never rewritten.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import unicodedata
from datetime import date, datetime, time
from pathlib import Path
from typing import Any

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter, range_boundaries

from yjmb_schema import ensure_optional_columns, find_header_row, header_key
from yjmb_taxonomy import SECTION_DISPLAY, canonical_formal_roles, canonical_section_entry, informal_roles_from_text


class ReviewRequired(Exception):
    pass


def norm(value: object) -> str:
    text = "" if value is None else str(value)
    text = unicodedata.normalize("NFKC", text).replace("\u00a0", " ")
    return re.sub(r"\s+", " ", text).strip()


def h(value: object) -> str:
    return header_key(value)


def namekey(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", norm(value).casefold()))


def json_cell(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return str(value)


def safe_cell_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (int, float, bool)):
        return value
    text = str(value).strip()
    if not text:
        return None
    # Member/admin web forms are data entry surfaces, not formula editors.
    if text.startswith("="):
        raise ReviewRequired("Workbook formulas cannot be submitted through the website editor.")
    return text


def relation_section(value: object) -> str:
    raw = norm(value)
    return SECTION_DISPLAY.get(raw.casefold(), raw)


def relation(name: object, year: object, section: object) -> str:
    try:
        year_text = str(int(year))
    except (TypeError, ValueError):
        year_text = norm(year)
    return f"{norm(name)} ({year_text}) ({relation_section(section)})"


def section_entry_text(entry: dict[str, Any] | None) -> str:
    section = norm((entry or {}).get("section"))
    if not section:
        return ""
    broad = SECTION_DISPLAY.get(section.casefold(), section)
    detail = norm((entry or {}).get("specificInstrument"))
    if not detail:
        return broad
    return canonical_section_entry(section, detail) or f"{broad} — {detail}"


def parse_row_id(value: object) -> int | None:
    match = re.fullmatch(r"row-(\d+)", norm(value))
    return int(match.group(1)) if match else None


def discover(ws):
    header_row = find_header_row(ws)
    headers = {col: h(ws.cell(header_row, col).value) for col in range(1, ws.max_column + 1)}
    aliases = {
        "given": ["givenpreferredname"],
        "nickname": ["nickname"],
        "family": ["familymaidenname"],
        "married": ["marriedname"],
        "year": ["ratyear", "year"],
        "instrument": ["instrument", "section"],
        "vet": ["vet"],
        "display": ["treedisplaynamepreference"],
        "sectionNick": ["sectionnicknames"],
        "specific": ["specificinstruments"],
        "memory": ["favoritetechbandmemory"],
        "otherFlag": ["participatedinothergtensembles"],
        "otherList": ["othergtensembles"],
        "otherInstFlag": ["playeddifferentinstrumentinothergtensembles"],
        "otherInst": ["othergtensembleinstruments"],
        "leadership": ["marchingbandleadershiproles"],
        "leadershipHistory": ["marchingbandleadershiphistory"],
        "informalFlag": ["servedininformalleadershipposition"],
        "informal": ["informalleadershippositions"],
        "bandClubFlag": ["servedinbandclubleadershipposition"],
        "bandClub": ["bandclubleadershippositions"],
        "bandClubHistory": ["bandclubleadershiphistory"],
        "leadershipClass": ["leadershippositionclassification"],
        "hasNick": ["hasnickname"],
        "changed": ["changedlastnamesinceband"],
        "multi": ["hasbeeninmultiplesections"],
        "currentRat": ["currentlyarat"],
        "pair": ["ratvetpairsystemapplied"],
    }
    mapping: dict[str, int] = {}
    for key, values in aliases.items():
        for col, value in headers.items():
            if value in values:
                mapping[key] = col
                break
    required = ["given", "nickname", "family", "married", "year", "instrument", "vet"]
    missing = [key for key in required if key not in mapping]
    if missing:
        raise RuntimeError("Missing required columns: " + ", ".join(missing))
    rats: list[tuple[int, int]] = []
    for col, value in headers.items():
        match = re.fullmatch(r"rat(\d+)", value)
        if match:
            rats.append((int(match.group(1)), col))
    rats.sort()
    if not rats:
        raise RuntimeError("No RAT columns found.")
    labels = {col: norm(ws.cell(header_row, col).value) for col in range(1, ws.max_column + 1)}
    label_to_col = {h(label): col for col, label in labels.items() if label}
    return header_row, mapping, rats, labels, label_to_col


def row_name(ws, row: int, mapping: dict[str, int]) -> str:
    return norm(f"{ws.cell(row, mapping['given']).value or ''} {ws.cell(row, mapping['family']).value or ''}")


def row_year(ws, row: int, mapping: dict[str, int]) -> int | None:
    try:
        return int(ws.cell(row, mapping["year"]).value)
    except (TypeError, ValueError):
        return None


def append_style_row(ws, header_row: int) -> int:
    old_max_row = ws.max_row
    row = old_max_row + 1
    source = max(header_row + 1, old_max_row)
    for col in range(1, ws.max_column + 1):
        src = ws.cell(source, col)
        dst = ws.cell(row, col)
        if src.has_style:
            dst._style = copy.copy(src._style)
        dst.font = copy.copy(src.font)
        dst.fill = copy.copy(src.fill)
        dst.border = copy.copy(src.border)
        dst.alignment = copy.copy(src.alignment)
        dst.protection = copy.copy(src.protection)
        dst.number_format = src.number_format
    for table in ws.tables.values():
        try:
            min_col, min_row, max_col, max_row = range_boundaries(table.ref)
        except ValueError:
            continue
        if min_row <= header_row <= max_row and max_row == old_max_row:
            table.ref = f"{get_column_letter(min_col)}{min_row}:{get_column_letter(max_col)}{row}"
    if ws.auto_filter and ws.auto_filter.ref:
        try:
            min_col, min_row, max_col, max_row = range_boundaries(ws.auto_filter.ref)
            if max_row == old_max_row:
                ws.auto_filter.ref = f"{get_column_letter(min_col)}{min_row}:{get_column_letter(max_col)}{row}"
        except ValueError:
            pass
    return row


def change_cell(ws, row: int, col: int, value: Any, label: str, changes: list[dict[str, Any]]) -> None:
    value = safe_cell_value(value)
    cell = ws.cell(row, col)
    before = cell.value
    if before == value or (norm(before) == norm(value) and not isinstance(value, (int, float, bool))):
        return
    cell.value = value
    changes.append({"row": row, "label": label, "before": json_cell(before), "after": json_cell(value)})


def set_mapped(ws, row: int, mapping: dict[str, int], labels: dict[int, str], key: str, value: Any, changes: list[dict[str, Any]]) -> None:
    col = mapping.get(key)
    if col:
        change_cell(ws, row, col, value, labels[col], changes)


def note_column(label_to_col: dict[str, int]) -> int | None:
    for key in ("notes", "note", "comments", "comment"):
        if key in label_to_col:
            return label_to_col[key]
    return None


def append_note(ws, row: int, col: int | None, note: str, label: str, changes: list[dict[str, Any]]) -> None:
    note = norm(note)
    if not col or not note:
        return
    existing = norm(ws.cell(row, col).value)
    value = note if not existing else f"{existing}\n{note}"
    change_cell(ws, row, col, value, label, changes)


def display_preference(value: object) -> str:
    key = norm(value).casefold()
    if key == "nickname":
        return "Nickname"
    if key == "both":
        return "Both"
    return "Given/Preferred Name"


def leadership_values(self_data: dict[str, Any]) -> tuple[list[str], str, str, str, str, str]:
    history = self_data.get("leadershipHistory") or []
    if not isinstance(history, list):
        history = []
    if not history:
        # Compatibility with the v15/v16 questionnaire payload.
        for role in self_data.get("marchingBandLeadershipRoles") or []:
            history.append({"type": "formal", "role": role, "years": ""})
        if self_data.get("informalLeadership") and norm(self_data.get("informalLeadershipDescription")):
            history.append({"type": "informal", "role": norm(self_data.get("informalLeadershipDescription")), "years": ""})

    formal_entries: list[dict[str, str]] = []
    informal_entries: list[dict[str, str]] = []
    for item in history:
        if not isinstance(item, dict):
            continue
        role = norm(item.get("role"))
        years = norm(item.get("years"))
        if not role:
            continue
        entry = {"role": role, "years": years}
        if norm(item.get("type")).casefold() == "informal":
            informal_entries.append(entry)
        else:
            formal_entries.append(entry)

    formal_roles = canonical_formal_roles(", ".join(item["role"] for item in formal_entries))
    # Preserve Other formal answers that taxonomy intentionally cannot canonicalize.
    for item in formal_entries:
        if item["role"] not in formal_roles and not canonical_formal_roles(item["role"]):
            formal_roles.append(item["role"])

    def fmt(item: dict[str, str]) -> str:
        return f"{item['role']} ({item['years']})" if item["years"] else item["role"]

    history_text = "; ".join(
        [*(f"Formal: {fmt(item)}" for item in formal_entries), *(f"Informal: {fmt(item)}" for item in informal_entries)]
    )
    informal_text = "; ".join(fmt(item) for item in informal_entries)
    informal_classified = []
    for item in informal_entries:
        values = informal_roles_from_text(item["role"])
        informal_classified.extend(values or [item["role"]])
    classification = "; ".join(
        [*(f"Formal: {role}" for role in formal_roles), *(f"Informal: {role}" for role in dict.fromkeys(informal_classified))]
    )

    club_history = self_data.get("bandClubLeadershipHistory") or []
    if not isinstance(club_history, list):
        club_history = []
    club_items = []
    for item in club_history:
        if not isinstance(item, dict):
            continue
        position = norm(item.get("position"))
        years = norm(item.get("years"))
        if position:
            club_items.append({"position": position, "years": years})
    club_text = "; ".join(f"{x['position']} ({x['years']})" if x["years"] else x["position"] for x in club_items)
    club_history_text = "; ".join(f"{x['position']} ({x['years']})" if x["years"] else x["position"] for x in club_items)
    return formal_roles, history_text, informal_text, classification, club_text, club_history_text


def apply_addition(ws, header_row, mapping, rat_cols, labels, label_to_col, payload, changes):
    self_data = payload.get("self") or {}
    given = norm(self_data.get("givenPreferredName"))
    family = norm(self_data.get("familyMaidenName"))
    try:
        year = int(self_data.get("ratYear"))
    except (TypeError, ValueError):
        raise ReviewRequired("Submitter RAT year is missing or invalid.")
    if not given or not family:
        raise ReviewRequired("Submitter name is incomplete.")
    for row in range(header_row + 1, ws.max_row + 1):
        if namekey(row_name(ws, row, mapping)) == namekey(f"{given} {family}") and row_year(ws, row, mapping) == year:
            raise ReviewRequired(f"A same-name/same-year person already exists in row {row}.")

    row = append_style_row(ws, header_row)
    sections = self_data.get("sections") or []
    section_names = [section_entry_text(item) for item in sections if isinstance(item, dict) and norm(item.get("section"))]
    instrument = "; ".join(filter(None, section_names)) or relation_section(self_data.get("section"))

    set_mapped(ws, row, mapping, labels, "given", given, changes)
    set_mapped(ws, row, mapping, labels, "nickname", norm(self_data.get("nickname")) or None, changes)
    set_mapped(ws, row, mapping, labels, "family", family, changes)
    set_mapped(ws, row, mapping, labels, "married", norm(self_data.get("marriedName")) or None, changes)
    set_mapped(ws, row, mapping, labels, "year", year, changes)
    set_mapped(ws, row, mapping, labels, "instrument", instrument, changes)
    set_mapped(ws, row, mapping, labels, "display", display_preference(self_data.get("treeNamePreference")), changes)
    set_mapped(
        ws, row, mapping, labels, "sectionNick",
        "; ".join(f"{relation_section(item.get('section'))}: {norm(item.get('sectionNickname'))}" for item in sections if isinstance(item, dict) and norm(item.get("sectionNickname"))) or None,
        changes,
    )
    set_mapped(
        ws, row, mapping, labels, "specific",
        "; ".join(f"{relation_section(item.get('section'))}: {norm(item.get('specificInstrument'))}" for item in sections if isinstance(item, dict) and norm(item.get("specificInstrument"))) or None,
        changes,
    )
    set_mapped(ws, row, mapping, labels, "memory", norm(payload.get("favoriteTechBandMemory")) or None, changes)
    set_mapped(ws, row, mapping, labels, "otherFlag", "Yes" if self_data.get("otherGtEnsembles") else "No", changes)
    set_mapped(ws, row, mapping, labels, "otherList", norm(self_data.get("otherGtEnsemblesList")) or None, changes)
    set_mapped(ws, row, mapping, labels, "otherInstFlag", "Yes" if self_data.get("playedDifferentGtInstrument") else "No", changes)
    set_mapped(ws, row, mapping, labels, "otherInst", norm(self_data.get("otherGtInstruments")) or None, changes)

    formal_roles, leadership_history, informal_text, classification, club_text, club_history = leadership_values(self_data)
    set_mapped(ws, row, mapping, labels, "leadership", ", ".join(formal_roles) or None, changes)
    set_mapped(ws, row, mapping, labels, "leadershipHistory", leadership_history or None, changes)
    set_mapped(ws, row, mapping, labels, "informalFlag", "Yes" if informal_text else "No", changes)
    set_mapped(ws, row, mapping, labels, "informal", informal_text or None, changes)
    set_mapped(ws, row, mapping, labels, "leadershipClass", classification or None, changes)
    set_mapped(ws, row, mapping, labels, "bandClubFlag", "Yes" if club_text or self_data.get("bandClubLeadership") else "No", changes)
    set_mapped(ws, row, mapping, labels, "bandClub", club_text or None, changes)
    set_mapped(ws, row, mapping, labels, "bandClubHistory", club_history or None, changes)

    set_mapped(ws, row, mapping, labels, "hasNick", "Yes" if self_data.get("hasNickname") else "No", changes)
    set_mapped(ws, row, mapping, labels, "changed", "Yes" if self_data.get("changedLastName") else "No", changes)
    set_mapped(ws, row, mapping, labels, "multi", "Yes" if self_data.get("multipleSections") else "No", changes)
    set_mapped(ws, row, mapping, labels, "currentRat", "Yes" if self_data.get("currentlyRat") else "No", changes)
    set_mapped(ws, row, mapping, labels, "pair", "Yes" if (payload.get("pairSystem") or {}).get("applies") else "No", changes)

    # v17 intentionally records only the submitter's side of each relationship.
    # Admin mode lists these unreciprocated claims and can validate the reverse side.
    vet = payload.get("vet") or None
    if vet:
        change_cell(ws, row, mapping["vet"], relation(vet.get("name"), vet.get("year"), vet.get("section")), labels[mapping["vet"]], changes)
    rats = payload.get("rats") or []
    if len(rats) > len(rat_cols):
        raise ReviewRequired("Submission has more RATs than the workbook has RAT columns.")
    for index, item in enumerate(rats):
        if not isinstance(item, dict):
            continue
        col = rat_cols[index][1]
        change_cell(ws, row, col, relation(item.get("name"), item.get("year"), item.get("section")), labels[col], changes)

    notes = payload.get("notes") or {}
    ncol = note_column(label_to_col)
    if isinstance(notes, dict):
        append_note(ws, row, ncol, notes.get("self", ""), labels.get(ncol, "Notes") if ncol else "Notes", changes)
        # Notes for matched related people also apply automatically in v17 and
        # remain revertible through the encrypted admin changelog.
        related_by_key: dict[str, int] = {}
        if vet and parse_row_id(vet.get("matchedId")):
            related_by_key["vet"] = parse_row_id(vet.get("matchedId"))  # type: ignore[assignment]
        for item in rats:
            if not isinstance(item, dict):
                continue
            rid = parse_row_id(item.get("matchedId"))
            if rid and item.get("key"):
                related_by_key[str(item["key"])] = rid
        for key, note in notes.items():
            target_row = related_by_key.get(str(key))
            if target_row and header_row < target_row <= ws.max_row:
                append_note(ws, target_row, ncol, note, labels.get(ncol, "Notes") if ncol else "Notes", changes)

    return row, f"Added {given} {family} ({year})"


def row_for_id(ws, header_row: int, person_id: object) -> int:
    row = parse_row_id(person_id)
    if not row or not (header_row < row <= ws.max_row):
        raise ReviewRequired(f"Person record {norm(person_id) or '[missing]'} no longer exists.")
    return row


def apply_field_changes(ws, row, changes_payload, labels, label_to_col, changes, *, stale_check: bool = True):
    if not isinstance(changes_payload, list) or not changes_payload:
        raise ReviewRequired("No field changes were supplied.")
    for item in changes_payload:
        if not isinstance(item, dict):
            continue
        label = norm(item.get("label"))
        col = label_to_col.get(h(label))
        if not label or not col:
            raise ReviewRequired(f"Workbook field {label!r} does not exist.")
        current = ws.cell(row, col).value
        if stale_check and "before" in item and norm(current) != norm(item.get("before")):
            raise ReviewRequired(f"{label} changed after this edit form was loaded; reload before overwriting it.")
        change_cell(ws, row, col, item.get("after"), labels[col], changes)


def apply_correction(ws, header_row, labels, label_to_col, payload, changes):
    row = row_for_id(ws, header_row, payload.get("personId"))
    # Member corrections intentionally apply against the authoritative workbook
    # even when the browser's encrypted-tree snapshot is older. change_cell()
    # records the workbook's *actual* current value in the encrypted changelog,
    # so the edit remains safely revertible without turning harmless snapshot
    # drift into an administrator-review loop. Structural validation still runs.
    apply_field_changes(ws, row, payload.get("changes"), labels, label_to_col, changes, stale_check=False)
    return row, f"Updated {norm(payload.get('personId'))}"


def apply_admin_patch(ws, header_row, labels, label_to_col, payload, changes):
    row = row_for_id(ws, header_row, payload.get("personId"))
    # An authenticated administrator patch follows the same authoritative-value
    # rule. The submitted ``before`` value is UI context only; the changelog
    # captures the real workbook value that was replaced.
    apply_field_changes(ws, row, payload.get("changes"), labels, label_to_col, changes, stale_check=False)
    return row, f"Admin edited {norm(payload.get('personId'))}"


def apply_admin_add(ws, header_row, mapping, labels, label_to_col, payload, changes):
    fields = payload.get("fields") or {}
    if not isinstance(fields, dict):
        raise ReviewRequired("Admin add requires a field mapping.")
    row = append_style_row(ws, header_row)
    for label, value in fields.items():
        col = label_to_col.get(h(label))
        if col:
            change_cell(ws, row, col, value, labels[col], changes)
    if not norm(ws.cell(row, mapping["given"]).value) or not norm(ws.cell(row, mapping["family"]).value):
        raise ReviewRequired("Admin-added rows require Given/Preferred Name and Family/Maiden Name.")
    year = row_year(ws, row, mapping)
    if year is None or not (1908 <= year <= datetime.now().year + 1):
        raise ReviewRequired("Admin-added rows require a valid four-digit RAT Year.")
    return row, f"Admin added {row_name(ws, row, mapping)}"


def apply_admin_delete(ws, header_row, labels, payload, changes):
    row = row_for_id(ws, header_row, payload.get("personId"))
    for col in range(1, ws.max_column + 1):
        if ws.cell(row, col).value is not None:
            change_cell(ws, row, col, None, labels.get(col, f"Column {col}"), changes)
    return row, f"Admin removed row {row}"


def person_relation(ws, row, mapping) -> str:
    return relation(row_name(ws, row, mapping), row_year(ws, row, mapping) or "", ws.cell(row, mapping["instrument"]).value)


def apply_admin_reciprocate(ws, header_row, mapping, rat_cols, labels, payload, changes):
    source_row = row_for_id(ws, header_row, payload.get("sourceId"))
    target_row = row_for_id(ws, header_row, payload.get("targetId"))
    role = norm(payload.get("role")).upper()
    if role == "VET":
        # Source says target is their VET; first verify that claim still exists,
        # then add source as a RAT on target. This prevents a stale admin page
        # from reciprocating a relationship that was edited in the meantime.
        source_claim = norm(ws.cell(source_row, mapping["vet"]).value)
        if not source_claim or namekey(source_claim.split(" (", 1)[0]) != namekey(row_name(ws, target_row, mapping)):
            raise ReviewRequired("The source profile no longer lists the selected target as its VET. Reload Admin Mode before validating.")
        source_rel = person_relation(ws, source_row, mapping)
        source_key = namekey(row_name(ws, source_row, mapping))
        for _, col in rat_cols:
            raw = norm(ws.cell(target_row, col).value)
            if raw and namekey(raw.split(" (", 1)[0]) == source_key:
                change_cell(ws, target_row, col, source_rel, labels[col], changes)
                return target_row, f"Validated reciprocal VET/RAT relationship for rows {source_row} and {target_row}"
        for _, col in rat_cols:
            if not norm(ws.cell(target_row, col).value):
                change_cell(ws, target_row, col, source_rel, labels[col], changes)
                return target_row, f"Validated reciprocal VET/RAT relationship for rows {source_row} and {target_row}"
        raise ReviewRequired(f"Target VET row {target_row} has no blank RAT slot.")
    if role == "RAT":
        # Source says target is their RAT; verify that one of source's RAT slots
        # still names this target before changing the target's VET field.
        target_key = namekey(row_name(ws, target_row, mapping))
        if not any(
            norm(ws.cell(source_row, rat_col).value)
            and namekey(norm(ws.cell(source_row, rat_col).value).split(" (", 1)[0]) == target_key
            for _, rat_col in rat_cols
        ):
            raise ReviewRequired("The source profile no longer lists the selected target as a RAT. Reload Admin Mode before validating.")
        source_rel = person_relation(ws, source_row, mapping)
        col = mapping["vet"]
        existing = norm(ws.cell(target_row, col).value)
        if existing and namekey(existing.split(" (", 1)[0]) != namekey(row_name(ws, source_row, mapping)):
            raise ReviewRequired(f"Target RAT row {target_row} already has a different VET.")
        change_cell(ws, target_row, col, source_rel, labels[col], changes)
        return target_row, f"Validated reciprocal RAT/VET relationship for rows {source_row} and {target_row}"
    raise ReviewRequired("Reciprocal validation role must be VET or RAT.")


def values_equivalent(left: Any, right: Any) -> bool:
    if left == right:
        return True
    return norm(left) == norm(right)


def apply_admin_revert(ws, header_row, labels, label_to_col, payload, changes, changelog_dir: Path):
    change_id = re.sub(r"[^A-Za-z0-9_.-]", "", norm(payload.get("changeId")))
    if not change_id:
        raise ReviewRequired("A changelog ID is required for revert.")
    path = changelog_dir / f"{change_id}.enc.json"
    if not path.exists():
        raise ReviewRequired(f"Changelog entry {change_id} was not found.")
    from secure_submission import decrypt_file
    entry = decrypt_file(path)
    original = entry.get("changes") or []
    if not original:
        raise ReviewRequired("The selected changelog entry has no cell changes to revert.")
    # Fail safely if a later update touched any of these cells.
    for item in original:
        row = int(item.get("row"))
        if not (header_row < row <= ws.max_row):
            raise ReviewRequired(f"Row {row} from the changelog no longer exists.")
        col = label_to_col.get(h(item.get("label")))
        if not col:
            raise ReviewRequired(f"Field {item.get('label')!r} from the changelog no longer exists.")
        if not values_equivalent(ws.cell(row, col).value, item.get("after")):
            raise ReviewRequired(f"Cannot safely revert {item.get('label')} on row {row}: it was changed again later.")
    for item in reversed(original):
        row = int(item.get("row"))
        col = label_to_col[h(item.get("label"))]
        change_cell(ws, row, col, item.get("before"), labels[col], changes)
    return int(original[0].get("row")), f"Reverted changelog entry {change_id}"


def apply(workbook: Path, submission_file: Path, *, changelog_dir: Path = Path("secure/changelog")) -> dict[str, Any]:
    wrapper = json.loads(submission_file.read_text(encoding="utf-8"))
    payload = wrapper.get("payload", wrapper)
    if not isinstance(payload, dict):
        raise ReviewRequired("Submission payload is invalid.")
    kind = norm(payload.get("kind") or wrapper.get("kind") or "addition").casefold()

    wb = load_workbook(workbook)
    try:
        if "People on Tree" not in wb.sheetnames:
            raise RuntimeError("Worksheet People on Tree not found.")
        ws = wb["People on Tree"]
        ensure_optional_columns(ws, header_row=find_header_row(ws))
        header_row, mapping, rat_cols, labels, label_to_col = discover(ws)
        changes: list[dict[str, Any]] = []

        if kind in {"addition", "add", "member-add"}:
            row, summary = apply_addition(ws, header_row, mapping, rat_cols, labels, label_to_col, payload, changes)
        elif kind == "correction":
            row, summary = apply_correction(ws, header_row, labels, label_to_col, payload, changes)
        elif kind == "admin-patch":
            row, summary = apply_admin_patch(ws, header_row, labels, label_to_col, payload, changes)
        elif kind == "admin-add":
            row, summary = apply_admin_add(ws, header_row, mapping, labels, label_to_col, payload, changes)
        elif kind == "admin-delete":
            row, summary = apply_admin_delete(ws, header_row, labels, payload, changes)
        elif kind == "admin-reciprocate":
            row, summary = apply_admin_reciprocate(ws, header_row, mapping, rat_cols, labels, payload, changes)
        elif kind == "admin-revert":
            row, summary = apply_admin_revert(ws, header_row, labels, label_to_col, payload, changes, changelog_dir)
        else:
            raise ReviewRequired(f"Unsupported update kind: {kind}")

        resulting_name = row_name(ws, row, mapping) if kind != "admin-delete" else ""
        if not changes:
            # Idempotent submissions are successful, not conflicts. This can happen
            # when the authoritative workbook already contains an edit that the
            # currently deployed encrypted tree has not caught up with yet. Marking
            # the request as a no-op lets the queue processor remove it cleanly and
            # ask the workflow to rebuild/redeploy the public tree from the current
            # authoritative workbook.
            return {
                "row": row,
                "kind": kind,
                "summary": summary,
                "changes": [],
                "name": resulting_name,
                "noop": True,
            }
        tmp = workbook.with_suffix(".secure-update.tmp.xlsx")
        wb.save(tmp)
        wb.close()
        os.replace(tmp, workbook)
        return {
            "row": row,
            "kind": kind,
            "summary": summary,
            "changes": changes,
            "name": resulting_name,
            "noop": False,
        }
    finally:
        try:
            wb.close()
        except Exception:
            pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workbook", type=Path, required=True)
    ap.add_argument("--submission", type=Path, required=True)
    ap.add_argument("--result", type=Path)
    ap.add_argument("--changelog-dir", type=Path, default=Path("secure/changelog"))
    args = ap.parse_args()
    try:
        result = apply(args.workbook, args.submission, changelog_dir=args.changelog_dir)
        output = {"status": "applied", **result}
        code = 0
    except ReviewRequired as exc:
        output = {"status": "review", "reason": str(exc)}
        code = 20
    if args.result:
        args.result.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    else:
        print(json.dumps(output, indent=2, ensure_ascii=False))
    raise SystemExit(code)


if __name__ == "__main__":
    main()
