import time

import pandas as pd

from app.domain.classify import classify
from app.domain.customers import resolve_salesperson
from app.data.data_access import fetch_line_items, fetch_salesperson_map, from_db
from app.domain.location import parse_location
from app.ingest.text_utils import clean_excel_text, clean_val

CACHE_TTL_SEC = 60
CACHE_MAX_ENTRIES = 6
# Keyed by (date_from, date_to) so switching ranges doesn't evict the previous
# range — flipping between This Month and This Year stays cheap.
_cache: dict[tuple[str | None, str | None], dict] = {}


def invalidate_cache() -> None:
    _cache.clear()


def _empty_payload(date_from: str | None, date_to: str | None) -> dict:
    return {
        "source": "Local Postgres",
        "generated_at": pd.Timestamp.now().isoformat(),
        "rows": [],
        "range": {"from": date_from, "to": date_to},
    }


def build_payload(date_from: str | None = None, date_to: str | None = None) -> dict:
    df = from_db(date_from, date_to)
    source = "Local Postgres"

    if df.empty:
        return _empty_payload(date_from, date_to)

    for col in [
        "quantity", "rate", "taxable_value", "gross_total",
        "sgst_9pct", "cgst_9pct", "igst_18pct",
        "gst_exports_fg", "gst_exports_rm", "gst_sales_dom_fg",
        "gst_sales_dom_rm", "scrap_sales",
        "discount", "gst_sales_freight", "round_off",
    ]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Taxable value as billed = (Value) − Discount + Freight. The raw "Value"
    # column from the Excel sheet on its own understates taxable because it
    # excludes freight and ignores discounts. We preserve the raw value as
    # `value_raw` so the underlying number stays visible if needed.
    if "taxable_value" in df.columns:
        v = df["taxable_value"].fillna(0)
        d = df["discount"].fillna(0) if "discount" in df.columns else 0
        f = df["gst_sales_freight"].fillna(0) if "gst_sales_freight" in df.columns else 0
        df["value_raw"] = v
        df["taxable_value"] = v - d + f

    df["category"] = df.apply(classify, axis=1)
    df["location"] = df["voucher_ref_no"].apply(parse_location) if "voucher_ref_no" in df.columns else None
    df["voucher_date"] = df["voucher_date"].dt.strftime("%Y-%m-%d")

    keep = [
        "voucher_date", "voucher_no", "voucher_type", "category", "particulars",
        "gstin_uin", "location", "quantity", "rate", "taxable_value", "value_raw",
        "discount", "gst_sales_freight", "gross_total",
        "sgst_9pct", "cgst_9pct", "igst_18pct",
    ]
    keep = [c for c in keep if c in df.columns]

    in_scope_vnos = df["voucher_no"].dropna().astype(str).tolist() if "voucher_no" in df.columns else []
    line_items_by_vno = fetch_line_items(in_scope_vnos)
    salesperson_by_customer = fetch_salesperson_map()
    rows = []
    for r in df[keep].to_dict(orient="records"):
        row = {k: clean_val(v) for k, v in r.items()}
        row["line_items"] = line_items_by_vno.get(row.get("voucher_no"), [])
        # Clean Excel artifacts in the visible customer name. The original
        # value stays in the DB; this only affects the payload sent to clients.
        if isinstance(row.get("particulars"), str):
            row["particulars"] = clean_excel_text(row["particulars"])
        row["sales_person"] = resolve_salesperson(row.get("particulars"), salesperson_by_customer)
        rows.append(row)
    return {
        "source": source,
        "generated_at": pd.Timestamp.now().isoformat(),
        "rows": rows,
        "range": {"from": date_from, "to": date_to},
    }


def get_cached_payload(date_from: str | None = None, date_to: str | None = None) -> dict:
    key = (date_from, date_to)
    now = time.time()
    entry = _cache.get(key)
    if entry and now - entry["fetched_at"] <= CACHE_TTL_SEC:
        return entry["payload"]
    payload = build_payload(date_from, date_to)
    _cache[key] = {"payload": payload, "fetched_at": now}
    # Cheap LRU-ish: drop oldest entries if we've blown the cap.
    while len(_cache) > CACHE_MAX_ENTRIES:
        oldest_key = min(_cache, key=lambda k: _cache[k]["fetched_at"])
        if oldest_key == key:
            break
        _cache.pop(oldest_key, None)
    return payload
