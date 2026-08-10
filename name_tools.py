"""Interactive name and relationship normalization utilities for YJMB tree data.

The canonical name schema is:
    Given/Preferred Name, Nickname, Family/Maiden Name, Married Name

``Married Name`` is intentionally left blank unless the data explicitly indicates,
or the user confirms, that the person adopted a spouse's surname.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from difflib import SequenceMatcher, get_close_matches
import json
from pathlib import Path
import re
import unicodedata
from typing import Iterable, Sequence


COMPOUND_FAMILY_NAMES: tuple[str, ...] = ("El Akkad",)
PLACEHOLDER_WORDS = {"rat", "vet", "unknown", "leftover", "maybe"}
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
RELATION_PAREN_RE = re.compile(
    r"^\s*(?P<name>.+?)\s*\(\s*(?P<year>(?:19|20)\d{2})(?:[^)]*)\)\s*"
    r"\(\s*(?P<instrument>.+?)\s*\)\s*$"
)
RELATION_LOOSE_RE = re.compile(
    r"^\s*(?P<name>.+?)\s+(?P<year>(?:19|20)\d{2})\s+(?P<instrument>.+?)\s*$"
)
QUOTED_NICKNAME_RE = re.compile(r'\s*["“](?P<nickname>[^"”]+)["”]\s*')
PAREN_MAIDEN_RE = re.compile(
    r"^\s*(?P<given>.+?)\s+\(\s*(?P<family>[^()]+?)\s*\)\s+(?P<married>[^()]+?)\s*$"
)
MAIDEN_MARKER_RE = re.compile(
    r"^\s*(?P<given>.+?)\s+(?:née|nee|maiden\s+name\s*:?|formerly)\s+"
    r"(?P<family>.+?)\s+(?:married\s+name\s*:?|now|->|→)\s+(?P<married>.+?)\s*$",
    flags=re.IGNORECASE,
)


class UserQuit(RuntimeError):
    """Raised when the user chooses to stop an interactive run."""


class SkipRecord(RuntimeError):
    """Raised when the user chooses to skip one record."""


@dataclass(frozen=True)
class NameParts:
    given: str
    nickname: str = ""
    family: str = ""
    married: str = ""

    @property
    def full(self) -> str:
        """Stable tree identity, preferring the family/maiden surname."""
        surname = self.family or self.married
        return normalize_spaces(f"{self.given} {surname}")

    @property
    def current_full(self) -> str:
        """Current legal/display surname when a married name is present."""
        surname = self.married or self.family
        return normalize_spaces(f"{self.given} {surname}")

    @property
    def descriptive_full(self) -> str:
        base = self.full
        if self.married and canonical_key(self.married) != canonical_key(self.family):
            return normalize_spaces(f"{base} (married name: {self.married})")
        return base


@dataclass(frozen=True)
class Relationship:
    name: str
    year: str
    instrument: str

    @property
    def formatted(self) -> str:
        return f"{self.name} ({self.year}) ({self.instrument})"


def normalize_spaces(value: object) -> str:
    """Normalize Unicode and whitespace without changing ordinary name casing."""
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    text = (
        text.replace("\u00a0", " ")
        .replace("\u2007", " ")
        .replace("\u202f", " ")
        .replace("“", '"')
        .replace("”", '"')
        .replace("’", "'")
        .replace("‘", "'")
        .replace("–", "-")
        .replace("—", "-")
    )
    return " ".join(text.split()).strip()


def canonical_key(value: object) -> str:
    """Comparison key tolerant of spacing, punctuation, and case differences."""
    text = normalize_spaces(value).casefold()
    text = re.sub(r"[\"'.,()\[\]{}]", "", text)
    text = re.sub(r"[-_/\\]+", " ", text)
    return " ".join(text.split())


def normalized_header(value: object) -> str:
    return canonical_key(value).replace(" ", "")


def looks_like_placeholder(name: str) -> bool:
    tokens = set(canonical_key(name).split())
    return bool(tokens & PLACEHOLDER_WORDS) or bool(re.match(r"^\d{4}\b", name))


def has_ambiguous_annotation(name: str) -> bool:
    lowered = f" {name.casefold()} "
    return any(
        marker in lowered
        for marker in (
            "(", ")", ",", '"', " née ", " nee ", " formerly ", " during those years",
            " when i was ", " i was ", " married name ", " maiden name ", " / ", " -> ", " → ",
        )
    )


def _ends_with_compound_family(name: str, compound_families: Sequence[str]) -> str | None:
    key = name.casefold()
    for family in sorted(compound_families, key=len, reverse=True):
        family_norm = normalize_spaces(family)
        if key.endswith(" " + family_norm.casefold()) or key == family_norm.casefold():
            return family_norm
    return None


def _extract_quoted_nickname(name: str) -> tuple[str, str]:
    match = QUOTED_NICKNAME_RE.search(name)
    if not match:
        return name, ""
    nickname = normalize_spaces(match.group("nickname"))
    without = normalize_spaces(name[: match.start()] + " " + name[match.end() :])
    return without, nickname


def propose_name_parts(
    raw_name: object,
    *,
    provided_given: object = "",
    provided_nickname: object = "",
    provided_family: object = "",
    provided_married: object = "",
    compound_families: Sequence[str] = COMPOUND_FAMILY_NAMES,
) -> NameParts:
    """Propose a four-field split without inventing a married surname.

    A married name is proposed only when explicitly supplied or clearly marked,
    such as ``Anne Marie (Hutchinson) Milner``. Plain three-word names are treated
    as multi-word given names plus one family surname and still may be confirmed
    by the caller.
    """
    name = normalize_spaces(raw_name)
    given_hint = normalize_spaces(provided_given)
    nickname_hint = normalize_spaces(provided_nickname)
    family_hint = normalize_spaces(provided_family)
    married_hint = normalize_spaces(provided_married)

    name_without_nick, parsed_nickname = _extract_quoted_nickname(name)
    nickname = nickname_hint or parsed_nickname

    # Explicitly separated source columns take priority over guessing.
    if given_hint and (family_hint or married_hint):
        return NameParts(given_hint, nickname, family_hint, married_hint)

    maiden_match = PAREN_MAIDEN_RE.match(name_without_nick)
    if maiden_match:
        return NameParts(
            normalize_spaces(maiden_match.group("given")),
            nickname,
            normalize_spaces(maiden_match.group("family")),
            normalize_spaces(maiden_match.group("married")),
        )

    marker_match = MAIDEN_MARKER_RE.match(name_without_nick)
    if marker_match:
        return NameParts(
            normalize_spaces(marker_match.group("given")),
            nickname,
            normalize_spaces(marker_match.group("family")),
            normalize_spaces(marker_match.group("married")),
        )

    if not name_without_nick:
        return NameParts(given_hint, nickname, family_hint, married_hint)

    compound = _ends_with_compound_family(name_without_nick, compound_families)
    if compound:
        given = normalize_spaces(name_without_nick[: -len(compound)])
        return NameParts(given or name_without_nick, nickname, compound if given else "", married_hint)

    if given_hint:
        name_key = name_without_nick.casefold()
        hint_key = given_hint.casefold()
        if name_key == hint_key:
            return NameParts(given_hint, nickname, family_hint, married_hint)
        if name_key.startswith(hint_key + " "):
            family = family_hint or normalize_spaces(name_without_nick[len(given_hint) :])
            return NameParts(given_hint, nickname, family, married_hint)

    # "Family, Given" is common enough to propose a swap, but still requires confirmation.
    if name_without_nick.count(",") == 1 and "(" not in name_without_nick:
        family, given = [normalize_spaces(part) for part in name_without_nick.split(",", 1)]
        if family and given:
            return NameParts(given, nickname, family, married_hint)

    tokens = name_without_nick.split()
    if len(tokens) == 1:
        return NameParts(tokens[0], nickname, family_hint, married_hint)
    return NameParts(" ".join(tokens[:-1]), nickname, family_hint or tokens[-1], married_hint)


def suspicious_case_or_spacing(raw: object) -> bool:
    text = "" if raw is None else str(raw)
    normalized = normalize_spaces(text)
    if text != normalized:
        return True
    letters = "".join(ch for ch in normalized if ch.isalpha())
    if len(letters) > 2 and (letters.islower() or letters.isupper()):
        # Preserve short initialisms such as AJ, CJ, JD, JR.
        if not (normalized.isupper() and len(normalized.replace(" ", "")) <= 4):
            return True
    if normalized and normalized[0].islower():
        return True
    return False


def close_name_candidates(
    raw_name: object,
    existing_names: Iterable[str],
    *,
    cutoff: float = 0.91,
    limit: int = 3,
) -> list[str]:
    raw = normalize_spaces(raw_name)
    if not raw:
        return []
    existing = sorted({normalize_spaces(name) for name in existing_names if normalize_spaces(name)})
    raw_key = canonical_key(raw)
    keyed: dict[str, str] = {canonical_key(name): name for name in existing}
    if raw_key in keyed:
        return []
    # Avoid expensive all-against-all similarity checks. A likely typo normally
    # retains the first character and approximately the same length.
    pool = [
        key for key in keyed
        if key and raw_key
        and key[0] == raw_key[0]
        and abs(len(key) - len(raw_key)) <= max(4, len(raw_key) // 4)
    ]
    key_matches = get_close_matches(raw_key, pool, n=limit, cutoff=cutoff)
    return [keyed[key] for key in key_matches]


def similarity(a: object, b: object) -> float:
    return SequenceMatcher(None, canonical_key(a), canonical_key(b)).ratio()


def _prompt(prompt: str) -> str:
    try:
        return input(prompt).strip()
    except (EOFError, KeyboardInterrupt) as exc:
        raise UserQuit("Interactive input was cancelled.") from exc


def ask_yes_no(prompt: str, *, default: bool = True) -> bool:
    suffix = " [Y/n]: " if default else " [y/N]: "
    while True:
        answer = _prompt(prompt + suffix).casefold()
        if not answer:
            return default
        if answer in {"y", "yes"}:
            return True
        if answer in {"n", "no"}:
            return False
        if answer in {"q", "quit", "exit"}:
            raise UserQuit("The user stopped the run.")
        print("Please enter y or n.")


class InteractiveResolver:
    """Resolve ambiguous names interactively and persist decisions in JSON."""

    CACHE_VERSION = "four-name-columns-v1"

    def __init__(
        self,
        cache_path: Path,
        *,
        interactive: bool = True,
        accept_auto: bool = False,
        compound_families: Sequence[str] = COMPOUND_FAMILY_NAMES,
    ) -> None:
        self.cache_path = Path(cache_path)
        self.interactive = interactive
        self.accept_auto = accept_auto
        self.compound_families = tuple(compound_families)
        self._cache: dict[str, dict[str, str]] = {}
        if self.cache_path.exists():
            try:
                loaded = json.loads(self.cache_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    self._cache = loaded
            except (OSError, json.JSONDecodeError):
                print(f"Warning: could not read decision cache {self.cache_path}; starting fresh.")

    def save(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.cache_path.with_suffix(self.cache_path.suffix + ".tmp")
        temp.write_text(
            json.dumps(self._cache, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        temp.replace(self.cache_path)

    def _cache_key(
        self,
        raw: object,
        provided_given: object = "",
        provided_nickname: object = "",
        provided_family: object = "",
        provided_married: object = "",
    ) -> str:
        values = (
            self.CACHE_VERSION,
            normalize_spaces(raw),
            normalize_spaces(provided_given),
            normalize_spaces(provided_nickname),
            normalize_spaces(provided_family),
            normalize_spaces(provided_married),
        )
        return "\u241f".join(values)

    def _manual_name_parts(self, current: NameParts) -> NameParts:
        given = normalize_spaces(_prompt(f"Given/Preferred Name [{current.given}]: ")) or current.given
        nickname = normalize_spaces(_prompt(f"Nickname (optional) [{current.nickname}]: "))
        if not nickname and current.nickname:
            nickname = current.nickname
        family = normalize_spaces(_prompt(f"Family/Maiden Name [{current.family}]: ")) or current.family
        married = normalize_spaces(_prompt(f"Married Name (optional) [{current.married}]: "))
        if not married and current.married:
            married = current.married
        if not given:
            raise ValueError("Given/Preferred Name cannot be blank.")
        if married and not ask_yes_no(
            f'Confirm that "{married}" is a spouse surname this person adopted?',
            default=True,
        ):
            married = ""
        return NameParts(given, nickname, family, married)

    def resolve_name(
        self,
        raw_name: object,
        *,
        context: str,
        existing_names: Iterable[str] = (),
        provided_given: object = "",
        provided_nickname: object = "",
        provided_family: object = "",
        provided_married: object = "",
        force_confirm: bool = False,
    ) -> NameParts:
        raw = normalize_spaces(raw_name)
        hint_given = normalize_spaces(provided_given)
        hint_nickname = normalize_spaces(provided_nickname)
        hint_family = normalize_spaces(provided_family)
        hint_married = normalize_spaces(provided_married)
        if not raw and not hint_given:
            raise ValueError(f"{context}: name is blank")
        raw = raw or normalize_spaces(f"{hint_given} {hint_family or hint_married}")

        cache_key = self._cache_key(raw, hint_given, hint_nickname, hint_family, hint_married)
        cached = self._cache.get(cache_key)
        if cached:
            return NameParts(
                cached.get("given", ""),
                cached.get("nickname", ""),
                cached.get("family", ""),
                cached.get("married", ""),
            )

        proposed = propose_name_parts(
            raw,
            provided_given=hint_given,
            provided_nickname=hint_nickname,
            provided_family=hint_family,
            provided_married=hint_married,
            compound_families=self.compound_families,
        )

        close = close_name_candidates(raw, existing_names) if (self.interactive or not self.accept_auto) else []
        requires = (
            force_confirm
            or suspicious_case_or_spacing(raw_name)
            or has_ambiguous_annotation(raw)
            or looks_like_placeholder(raw)
            or not proposed.family
            or bool(close)
            or bool(proposed.married)
            or (hint_given and not canonical_key(raw).startswith(canonical_key(hint_given)))
        )

        if close and self.interactive:
            print(f"\n[{context}] Potential existing-name match for {raw!r}:")
            for index, candidate in enumerate(close, start=1):
                print(f"  {index}. {candidate} (similarity {similarity(raw, candidate):.1%})")
            answer = _prompt(
                f'Did you mean "{close[0]}" instead of "{raw}"? '
                "[y/N/number/e=enter manually/q]: "
            ).casefold()
            if answer in {"q", "quit", "exit"}:
                raise UserQuit("The user stopped the run.")
            if answer in {"y", "yes"}:
                raw = close[0]
                proposed = propose_name_parts(raw, compound_families=self.compound_families)
                requires = True
            elif answer.isdigit() and 1 <= int(answer) <= len(close):
                raw = close[int(answer) - 1]
                proposed = propose_name_parts(raw, compound_families=self.compound_families)
                requires = True
            elif answer in {"e", "edit"}:
                proposed = self._manual_name_parts(proposed)
                requires = False

        if requires and not self.interactive and not self.accept_auto:
            raise ValueError(
                f"{context}: {raw!r} needs confirmation. Re-run interactively or use --accept-auto. "
                f"Proposed fields: {proposed.given!r} / {proposed.nickname!r} / "
                f"{proposed.family!r} / {proposed.married!r}."
            )

        if requires and self.interactive:
            print(f"\n[{context}] Original name: {normalize_spaces(raw_name)!r}")
            if normalize_spaces(raw_name) != raw:
                print(f"Normalized/corrected name: {raw!r}")
            print("Married Name must stay blank unless the person adopted a spouse's surname.")
            while True:
                answer = _prompt(
                    "Did you mean "
                    f'Given/Preferred Name="{proposed.given}", '
                    f'Nickname="{proposed.nickname}", '
                    f'Family/Maiden Name="{proposed.family}", and '
                    f'Married Name="{proposed.married}"? '
                    "[Y/e=edit/k=keep whole name/s=skip/q]: "
                ).casefold()
                if answer in {"", "y", "yes"}:
                    if proposed.married and not ask_yes_no(
                        f'Confirm that "{proposed.married}" is a spouse surname this person adopted?',
                        default=True,
                    ):
                        proposed = NameParts(proposed.given, proposed.nickname, proposed.family, "")
                    break
                if answer in {"e", "edit"}:
                    try:
                        proposed = self._manual_name_parts(proposed)
                    except ValueError as exc:
                        print(exc)
                    continue
                if answer in {"k", "keep"}:
                    proposed = NameParts(raw, hint_nickname, "", "")
                    break
                if answer in {"s", "skip"}:
                    raise SkipRecord(f"Skipped {context}: {raw}")
                if answer in {"q", "quit", "exit"}:
                    raise UserQuit("The user stopped the run.")
                print("Enter Y, e, k, s, or q.")

        if not proposed.given:
            raise ValueError(f"{context}: Given/Preferred Name cannot be blank")
        if proposed.married and canonical_key(proposed.married) == canonical_key(proposed.family):
            proposed = NameParts(proposed.given, proposed.nickname, proposed.family, "")
        self._cache[cache_key] = asdict(proposed)
        self.save()
        return proposed

    def resolve_relationship(
        self,
        raw_value: object,
        *,
        context: str,
        known_names: Iterable[str] = (),
    ) -> str:
        raw = normalize_spaces(raw_value)
        if not raw:
            return ""

        match = RELATION_PAREN_RE.match(raw)
        loose = False
        if not match:
            match = RELATION_LOOSE_RE.match(raw)
            loose = bool(match)

        if match:
            name = normalize_spaces(match.group("name"))
            year = normalize_spaces(match.group("year"))[:4]
            instrument = normalize_spaces(match.group("instrument"))
            instrument = re.sub(r"\s*[/,]\s*", lambda m: "/" if "/" in m.group(0) else ", ", instrument)
            relation = Relationship(name, year, instrument)
        else:
            if not self.interactive and not self.accept_auto:
                raise ValueError(
                    f"{context}: relationship is not in 'Name (YYYY) (Instrument)' format: {raw!r}"
                )
            if self.interactive:
                print(f"\n[{context}] Could not parse: {raw!r}")
                print("Enter the intended relationship. Press Enter on a field to keep the original raw text.")
                name = normalize_spaces(_prompt("Person's full name: "))
                if not name:
                    if ask_yes_no(f"Keep the unparsed text exactly as {raw!r}?", default=False):
                        return raw
                    raise SkipRecord(f"Skipped malformed relationship in {context}")
                year = normalize_spaces(_prompt("RAT year (YYYY): "))
                instrument = normalize_spaces(_prompt("Instrument(s): "))
                relation = Relationship(name, year, instrument)
            else:
                return raw

        candidates = close_name_candidates(relation.name, known_names, cutoff=0.93) if self.interactive else []
        if candidates and self.interactive:
            answer = _prompt(
                f'Did you mean "{candidates[0]}" instead of "{relation.name}" in {context}? '
                "[y/N/e/q]: "
            ).casefold()
            if answer in {"y", "yes"}:
                relation = Relationship(candidates[0], relation.year, relation.instrument)
            elif answer in {"e", "edit"}:
                relation = Relationship(
                    normalize_spaces(_prompt("Correct full name: ")) or relation.name,
                    relation.year,
                    relation.instrument,
                )
            elif answer in {"q", "quit", "exit"}:
                raise UserQuit("The user stopped the run.")

        formatted = relation.formatted
        if self.interactive and (loose or formatted != raw):
            if not ask_yes_no(f'Did you mean "{formatted}"?', default=True):
                edited = normalize_spaces(_prompt("Enter the exact relationship text to store: "))
                return edited or raw
        return formatted


def extract_relation_name(value: object) -> str:
    raw = normalize_spaces(value)
    if not raw:
        return ""
    match = RELATION_PAREN_RE.match(raw) or RELATION_LOOSE_RE.match(raw)
    if match:
        return normalize_spaces(match.group("name"))
    return normalize_spaces(raw.split(" (", 1)[0])


def split_instrument_terms(value: object) -> list[str]:
    text = normalize_spaces(value).casefold()
    text = text.replace("front emsemble", "front ensemble")
    text = re.sub(r"\band\b", ",", text)
    parts = [normalize_spaces(part) for part in re.split(r"[,/;&]+", text)]
    return [part for part in parts if part]
