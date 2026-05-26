import pandas as pd

from text_utils import has_value


def classify(row) -> str:
    vt = str(row.get("voucher_type") or "").lower()
    if "b2c" in vt:
        return "B2C"
    if has_value(row.get("gst_exports_fg")):
        return "Export - Finished Goods"
    if has_value(row.get("gst_exports_rm")):
        return "Export - Raw Material"
    if has_value(row.get("gst_sales_dom_fg")):
        return "Domestic - Finished Goods"
    if has_value(row.get("gst_sales_dom_rm")):
        return "Domestic - Raw Material"
    if pd.notna(row.get("scrap_sales")):
        return "Scrap"
    if pd.notna(row.get("igst_18pct")):
        return "Domestic Inter-State"
    if pd.notna(row.get("sgst_9pct")) or pd.notna(row.get("cgst_9pct")):
        return "Domestic Intra-State"
    return "Other"
