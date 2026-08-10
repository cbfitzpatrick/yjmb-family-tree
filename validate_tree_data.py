"""Validate four-name-column YJMB workbooks and print actionable warnings."""
from __future__ import annotations
import argparse
from collections import Counter
from pathlib import Path
from openpyxl import load_workbook
from name_tools import RELATION_LOOSE_RE, RELATION_PAREN_RE, canonical_key, extract_relation_name, has_ambiguous_annotation, normalize_spaces
from tree_workbook import is_split_name_sheet, iter_records, record_name_aliases

def validate(path: Path) -> int:
    workbook=load_workbook(path,read_only=False,data_only=False); all_names=set(); records_by_sheet={}; issues=[]
    for ws in workbook.worksheets:
        if not is_split_name_sheet(ws): continue
        rows=list(iter_records(ws)); records_by_sheet[ws.title]=rows
        for _,record in rows:
            all_names.update(canonical_key(name) for name in record_name_aliases(record))
    for sheet_name,rows in records_by_sheet.items():
        identities=Counter()
        for row_number,record in rows:
            name=normalize_spaces(record["full_name"]); year=normalize_spaces(record["rat_year"])[:4]; instrument=normalize_spaces(record["instrument"])
            identities[(canonical_key(name),year)]+=1
            if not record.get("given"): issues.append(f"{sheet_name} row {row_number}: blank Given/Preferred Name")
            if not record.get("family") and not record.get("married"): issues.append(f"{sheet_name} row {row_number}: both surname fields are blank for {name!r}")
            married=normalize_spaces(record.get("married")); family=normalize_spaces(record.get("family")); nickname=normalize_spaces(record.get("nickname"))
            if married and canonical_key(married)==canonical_key(family): issues.append(f"{sheet_name} row {row_number}: Married Name duplicates Family/Maiden Name for {name!r}")
            if married and has_ambiguous_annotation(married): issues.append(f"{sheet_name} row {row_number}: unusual Married Name {married!r}")
            if family and has_ambiguous_annotation(family): issues.append(f"{sheet_name} row {row_number}: Family/Maiden Name may still contain an annotation: {family!r}")
            if nickname and nickname.startswith('"') and nickname.endswith('"'): issues.append(f"{sheet_name} row {row_number}: remove quote marks from Nickname {nickname!r}")
            if len(year)!=4 or not year.isdigit(): issues.append(f"{sheet_name} row {row_number}: unusual RAT year {record.get('rat_year')!r}")
            if not instrument: issues.append(f"{sheet_name} row {row_number}: blank instrument for {name!r}")
            for field in ["vet",*[f"rat_{i}" for i in range(1,8)]]:
                value=normalize_spaces(record.get(field));
                if not value: continue
                if not (RELATION_PAREN_RE.match(value) or RELATION_LOOSE_RE.match(value)): issues.append(f"{sheet_name} row {row_number}: malformed {field.upper()} value {value!r}")
                related=canonical_key(extract_relation_name(value))
                if related and related not in all_names: issues.append(f"{sheet_name} row {row_number}: {field.upper()} references a name not found in migrated tables: {extract_relation_name(value)!r}")
        for (name_key,year),count in identities.items():
            if count>1: issues.append(f"{sheet_name}: duplicate person/year key {name_key!r} / {year!r} appears {count} times")
    workbook.close(); print(f"Workbook: {path}\nFour-column sheets checked: {len(records_by_sheet)}\nIssues found: {len(issues)}")
    for issue in issues: print(f"- {issue}")
    return 1 if issues else 0

def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument("workbook",type=Path); a=p.parse_args(); return validate(a.workbook.expanduser().resolve())
if __name__=="__main__": raise SystemExit(main())
