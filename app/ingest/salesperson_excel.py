import re

import pandas as pd

from app.ingest.text_utils import clean_excel_text, salesperson_canon

CUSTOMER_KEYS = {"customername", "customer", "partyname", "party", "particulars"}
PERSON_KEYS = {
    "salesperson", "sales", "salesman", "salesexecutive", "salesexec",
    "salespersonname", "personname",
}
TARGET_SHEET_KEY = "customerlistwithsalesperson"


def norm_col(c) -> str:
    return re.sub(r"[^a-z0-9]", "", str(c or "").lower())


def find_cols(cols):
    norm_to_actual = {norm_col(c): c for c in cols}
    c = next((norm_to_actual[k] for k in norm_to_actual if k in CUSTOMER_KEYS), None)
    p = next((norm_to_actual[k] for k in norm_to_actual if k in PERSON_KEYS), None)
    return c, p


def parse_sheet(sheet_df: pd.DataFrame):
    """Return (records, customer_col, person_col) for a single sheet, or (None, None, None)."""
    c, p = find_cols(sheet_df.columns)
    if not c or not p:
        raw = sheet_df.copy()
        raw.columns = range(len(raw.columns))
        for i in range(min(10, len(raw))):
            candidate = list(raw.iloc[i].astype(object))
            c2, p2 = find_cols(candidate)
            if c2 and p2:
                sheet_df = sheet_df.iloc[i + 1:].copy()
                sheet_df.columns = list(raw.iloc[i].astype(object))
                c, p = find_cols(sheet_df.columns)
                break
    if not c or not p:
        return None, None, None
    recs = []
    for _, raw in sheet_df.iterrows():
        name = clean_excel_text(raw.get(c))
        person = salesperson_canon(clean_excel_text(raw.get(p)))
        if not name or not person:
            continue
        recs.append({"customer_name": name, "sales_person": person})
    return recs, c, p
