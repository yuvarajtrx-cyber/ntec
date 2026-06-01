import re

from app.ingest.text_utils import clean_excel_text

_ENTITY_SUFFIXES = sorted([
    "private limited", "pvt limited", "private ltd", "pvt ltd", "p ltd",
    "p limited", "pvt", "private", "limited", "ltd",
    "llp", "inc", "corp", "corporation", "company", "co",
    "and company", "and co",
], key=lambda s: -len(s.split()))


def customer_key(name) -> str:
    """Normalize a customer name for joining transactions ↔ mapping.

    Lowercases, strips punctuation, collapses whitespace, then strips
    trailing Indian-company entity suffixes (Pvt Ltd / Private Limited /
    Limited / etc.) so e.g. 'Radium Creation Private Limited' and
    'Radium Creation Limited' both key to 'radium creation'.
    """
    s = clean_excel_text(name).lower()
    if not s:
        return ""
    s = re.sub(r"[.,;:'\"()\[\]/\\\-_]", " ", s)
    s = re.sub(r"&", " and ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Repeatedly peel trailing entity suffixes, but keep at least one word.
    changed = True
    while changed:
        changed = False
        for suf in _ENTITY_SUFFIXES:
            if s.endswith(" " + suf):
                stripped = s[:-(len(suf) + 1)].strip()
                if stripped:
                    s = stripped
                    changed = True
                    break
    return s


def customer_key_variants(name) -> list[str]:
    """Return exact-first customer keys, then conservative base-name fallbacks."""
    raw = clean_excel_text(name)
    if not raw:
        return []

    candidates = [raw]
    # Branch/location suffixes commonly arrive as "Name - City".
    if re.search(r"\s*[-–—]\s*", raw):
        candidates.append(re.split(r"\s*[-–—]\s*", raw, maxsplit=1)[0])

    # Some sales names have parenthetical branch hints that are absent in maps.
    without_parens = re.sub(r"\([^)]*\)", " ", raw)
    if without_parens != raw:
        candidates.append(without_parens)
        if re.search(r"\s*[-–—]\s*", without_parens):
            candidates.append(re.split(r"\s*[-–—]\s*", without_parens, maxsplit=1)[0])

    keys: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = customer_key(candidate)
        if key and key not in seen:
            seen.add(key)
            keys.append(key)
    return keys


def resolve_salesperson(name, salesperson_by_customer: dict[str, str]) -> str:
    for key in customer_key_variants(name):
        person = salesperson_by_customer.get(key)
        if person:
            return person
    return "Unassigned"
