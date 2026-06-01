import math
import re

import pandas as pd


def clean_excel_text(value) -> str:
    """Clean common Excel artifacts from uploaded/customer text."""
    if value is None:
        return ""
    s = str(value)
    if not s or s.lower() == "nan":
        return ""
    s = re.sub(r"_x[0-9a-fA-F]{4}_", " ", s)
    s = re.sub(r"[\r\n\t]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def clean_val(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def has_value(v) -> bool:
    if v is None:
        return False
    if isinstance(v, float) and math.isnan(v):
        return False
    if isinstance(v, str) and not v.strip():
        return False
    return pd.notna(v)


def salesperson_canon(name) -> str:
    """Canonical form for a salesperson name. Trims, collapses whitespace,
    and title-cases so 'BALAJI', 'balaji', 'Balaji ' all become 'Balaji'."""
    if not name:
        return ""
    s = re.sub(r"\s+", " ", str(name)).strip()
    if s.lower() in {"-", "na", "n/a", "none", "nil", "nan"}:
        return ""
    return s.title()
