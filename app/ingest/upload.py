import math

import pandas as pd

LINE_ITEM_TABLE = "sales_line_item"

# Excel column name -> sales_register DB column name (voucher header rows)
COLUMN_MAP = {
    "Date":                                        "voucher_date",
    "Particulars":                                 "particulars",
    "Voucher Type":                                "voucher_type",
    "Voucher No.":                                 "voucher_no",
    "Voucher Ref. No.":                            "voucher_ref_no",
    "GSTIN/UIN":                                   "gstin_uin",
    "Quantity":                                    "quantity",
    "Rate":                                        "rate",
    "Value":                                       "taxable_value",
    "Gross Total":                                 "gross_total",
    "GST Sales Domestic - FG":                     "gst_sales_dom_fg",
    "SGST @ 9%":                                   "sgst_9pct",
    "CGST @ 9%":                                   "cgst_9pct",
    "Round Off":                                   "round_off",
    "Discount":                                    "discount",
    "GST Sales Frieght":                           "gst_sales_freight",
    "IGST @ 18%":                                  "igst_18pct",
    "GST Sales Domestic - RM":                     "gst_sales_dom_rm",
    "Scrap Sales":                                 "scrap_sales",
    "TCS @ 1% ( Scrap Sales ) - ( 206 CE ) - 6CE": "tcs_scrap_206ce",
    "GST Exports - RM":                            "gst_exports_rm",
    "GST Exports - FG":                            "gst_exports_fg",
}


def _clean(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if isinstance(v, str):
        s = v.strip()
        if s == "" or s.lower() in {"nan", "none"}:
            return None
        return s
    return v


def parse_workbook(df: pd.DataFrame) -> tuple[list[dict], list[dict]]:
    """Split the workbook into voucher header rows and product line-item rows.

    Header row = has a non-null Date. Line-item row = blank Date, belongs to the
    most recent header above it.
    """
    df = df[df["Particulars"].astype(str).str.strip().str.lower() != "grand total"]

    vouchers: list[dict] = []
    line_items: list[dict] = []
    current_vno: str | None = None
    current_line_no = 0

    for _, raw in df.iterrows():
        date = raw.get("Date")
        is_header = pd.notna(date)

        if is_header:
            v: dict = {}
            for excel_col, db_col in COLUMN_MAP.items():
                if excel_col in df.columns:
                    v[db_col] = _clean(raw[excel_col])
            v["voucher_date"] = pd.to_datetime(v["voucher_date"]).strftime("%Y-%m-%d")
            vouchers.append(v)
            current_vno = v.get("voucher_no")
            current_line_no = 0
        else:
            if current_vno is None:
                continue
            current_line_no += 1
            line_items.append({
                "voucher_no": current_vno,
                "line_no": current_line_no,
                "particulars": _clean(raw.get("Particulars")),
                "quantity": _clean(raw.get("Quantity")),
                "rate": _clean(raw.get("Rate")),
                "value": _clean(raw.get("Value")),
            })

    return vouchers, line_items
