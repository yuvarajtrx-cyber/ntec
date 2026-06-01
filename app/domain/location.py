import re

LOCATION_RE = re.compile(
    r"(?:dispatch\s+)?(?:from|form|frrom)\s*:?\s*(.+?)\s*$",
    re.IGNORECASE,
)
LOCATION_ALIASES = {
    "alappakam": "Alapakkam",
    "pallaram": "Pallavaram",
    "pallavram": "Pallavaram",
    "tirpur": "Tirupur",
    "tiruppur": "Tirupur",
    "tirupr": "Tirupur",
    "tirurpur": "Tirupur",
    "tiupur": "Tirupur",
    "triupur": "Tirupur",
}


def parse_location(ref):
    """Pull the location out of a voucher ref like 'DISPATCH FROM TIRUPUR'."""
    if ref is None:
        return None
    s = str(ref).strip()
    if not s or s.lower() == "nan":
        return None
    if "material used" in s.lower():
        return "Other Dispatch"
    m = LOCATION_RE.search(s)
    if not m:
        return None
    loc = m.group(1).strip().strip(":").strip()
    return normalize_location(loc)


def normalize_location(loc):
    if loc is None:
        return None
    s = re.sub(r"\s+", " ", str(loc).strip())
    if not s or s.lower() == "nan":
        return None
    key = re.sub(r"[^a-z]", "", s.lower())
    return LOCATION_ALIASES.get(key, s.title())
