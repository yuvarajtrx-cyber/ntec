import io
import math
import re
import time
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from psycopg import sql

import db
from upload import LINE_ITEM_TABLE, parse_workbook

HERE = Path(__file__).parent
TABLE_NAME = "sales_register"
SALESPERSON_TABLE = "customer_salesperson"
CACHE_TTL_SEC = 60

load_dotenv()
app = Flask(__name__, static_folder=str(HERE), static_url_path="")
_cache = {"payload": None, "fetched_at": 0.0}

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


def has_value(v) -> bool:
    if v is None:
        return False
    if isinstance(v, float) and math.isnan(v):
        return False
    if isinstance(v, str) and not v.strip():
        return False
    return pd.notna(v)


def clean_val(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


class DataSourceError(Exception):
    """Raised when the database is unreachable or returns no rows."""


def from_db() -> pd.DataFrame:
    try:
        rows = db.fetch_all(f"SELECT * FROM {TABLE_NAME} ORDER BY voucher_date")
    except Exception as e:
        raise DataSourceError(f"Could not fetch from Postgres: {e}") from e

    if not rows:
        raise DataSourceError(
            f"Table '{TABLE_NAME}' is empty. Use the Upload button to add data."
        )

    df = pd.DataFrame(rows)
    df["voucher_date"] = pd.to_datetime(df["voucher_date"])
    return df


def salesperson_canon(name) -> str:
    if not name:
        return ""
    s = re.sub(r"\s+", " ", str(name)).strip()
    if s.lower() in {"-", "na", "n/a", "none", "nil", "nan"}:
        return ""
    return s.title()


_ENTITY_SUFFIXES = sorted([
    "private limited", "pvt limited", "private ltd", "pvt ltd", "p ltd",
    "p limited", "pvt", "private", "limited", "ltd",
    "llp", "inc", "corp", "corporation", "company", "co",
    "and company", "and co",
], key=lambda s: -len(s.split()))


def clean_excel_text(value) -> str:
    if value is None:
        return ""
    s = str(value)
    if not s or s.lower() == "nan":
        return ""
    s = re.sub(r"_x[0-9a-fA-F]{4}_", " ", s)
    s = re.sub(r"[\r\n\t]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def customer_key(name) -> str:
    s = clean_excel_text(name).lower()
    if not s:
        return ""
    s = re.sub(r"[.,;:'\"()\[\]/\\\-_]", " ", s)
    s = re.sub(r"&", " and ", s)
    s = re.sub(r"\s+", " ", s).strip()
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
    raw = clean_excel_text(name)
    if not raw:
        return []
    candidates = [raw]
    if re.search(r"\s*[-–—]\s*", raw):
        candidates.append(re.split(r"\s*[-–—]\s*", raw, maxsplit=1)[0])
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


def fetch_salesperson_map() -> dict[str, str]:
    try:
        rows = db.fetch_all(f"SELECT customer_name, sales_person FROM {SALESPERSON_TABLE}")
    except Exception:
        return {}
    out: dict[str, str] = {}
    alias_people: dict[str, set[str]] = {}
    for r in rows:
        person = salesperson_canon(r.get("sales_person"))
        if not person:
            continue
        variants = customer_key_variants(r.get("customer_name"))
        if not variants:
            continue
        key = variants[0]
        if key:
            out[key] = person
        for alias in variants[1:]:
            alias_people.setdefault(alias, set()).add(person)
    for alias, people in alias_people.items():
        if alias not in out and len(people) == 1:
            out[alias] = next(iter(people))
    return out


def fetch_line_items() -> dict[str, list[dict]]:
    try:
        rows = db.fetch_all(
            f"SELECT voucher_no, line_no, particulars, quantity, rate, value "
            f"FROM {LINE_ITEM_TABLE} ORDER BY voucher_no, line_no"
        )
    except Exception:
        return {}
    grouped: dict[str, list[dict]] = {}
    for r in rows:
        vno = r.get("voucher_no")
        if not vno:
            continue
        grouped.setdefault(vno, []).append({
            "line_no": r.get("line_no"),
            "particulars": r.get("particulars"),
            "quantity": float(r["quantity"]) if r.get("quantity") is not None else None,
            "rate": float(r["rate"]) if r.get("rate") is not None else None,
            "value": float(r["value"]) if r.get("value") is not None else None,
        })
    return grouped


def build_payload() -> dict:
    df = from_db()
    source = "Local Postgres"

    for col in [
        "quantity", "rate", "taxable_value", "gross_total",
        "sgst_9pct", "cgst_9pct", "igst_18pct",
        "gst_exports_fg", "gst_exports_rm", "gst_sales_dom_fg",
        "gst_sales_dom_rm", "scrap_sales",
    ]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df["category"] = df.apply(classify, axis=1)
    df["location"] = df["voucher_ref_no"].apply(parse_location) if "voucher_ref_no" in df.columns else None
    df["voucher_date"] = df["voucher_date"].dt.strftime("%Y-%m-%d")

    keep = [
        "voucher_date", "voucher_no", "voucher_type", "category", "particulars",
        "gstin_uin", "location", "quantity", "rate", "taxable_value", "gross_total",
        "sgst_9pct", "cgst_9pct", "igst_18pct",
    ]
    keep = [c for c in keep if c in df.columns]

    line_items_by_vno = fetch_line_items()
    salesperson_by_customer = fetch_salesperson_map()
    rows = []
    for r in df[keep].to_dict(orient="records"):
        row = {k: clean_val(v) for k, v in r.items()}
        row["line_items"] = line_items_by_vno.get(row.get("voucher_no"), [])
        if isinstance(row.get("particulars"), str):
            row["particulars"] = clean_excel_text(row["particulars"])
        row["sales_person"] = resolve_salesperson(row.get("particulars"), salesperson_by_customer)
        rows.append(row)
    return {
        "source": source,
        "generated_at": pd.Timestamp.now().isoformat(),
        "rows": rows,
    }


@app.get("/api/sales")
def api_sales():
    now = time.time()
    if _cache["payload"] is None or now - _cache["fetched_at"] > CACHE_TTL_SEC:
        try:
            _cache["payload"] = build_payload()
            _cache["fetched_at"] = now
        except DataSourceError as e:
            return jsonify({"error": str(e)}), 503
    return jsonify(_cache["payload"])


@app.post("/api/upload")
def api_upload():
    """Accept an Excel file, clean it, and insert into Postgres."""
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "No file provided"}), 400
    if not f.filename.lower().endswith((".xlsx", ".xls")):
        return jsonify({"error": "File must be .xlsx or .xls"}), 400

    try:
        df = pd.read_excel(f)
    except Exception as e:
        return jsonify({"error": f"Failed to parse Excel: {e}"}), 400

    if "Particulars" not in df.columns or "Date" not in df.columns:
        return jsonify({
            "error": "Expected columns 'Date' and 'Particulars' not found. "
                     "Is this a GST sales register export?"
        }), 400

    vouchers, line_items = parse_workbook(df)

    if not vouchers:
        return jsonify({"error": "No voucher header rows (with a Date) found in the file"}), 400

    try:
        with db.connect() as conn, conn.cursor() as cur:
            _insert_records(cur, TABLE_NAME, vouchers)
            _insert_records(cur, LINE_ITEM_TABLE, line_items)
    except Exception as e:
        return jsonify({
            "error": f"Insert failed: {e}",
            "inserted": 0,
        }), 500

    _cache["payload"] = None
    _cache["fetched_at"] = 0.0

    return jsonify({
        "inserted": len(vouchers),
        "line_items_inserted": len(line_items),
        "rows_in_file": len(df),
        "filename": f.filename,
    })


@app.post("/api/upload-salespersons")
def api_upload_salespersons():
    """Accept a salesperson-mapping Excel and FULLY REPLACE the table."""
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "No file provided"}), 400
    if not f.filename.lower().endswith((".xlsx", ".xls")):
        return jsonify({"error": "File must be .xlsx or .xls"}), 400

    def norm_col(c) -> str:
        return re.sub(r"[^a-z0-9]", "", str(c or "").lower())

    CUSTOMER_KEYS = {"customername", "customer", "partyname", "party", "particulars"}
    PERSON_KEYS   = {"salesperson", "sales", "salesman", "salesexecutive", "salesexec",
                     "salespersonname", "personname"}

    def find_cols(cols):
        norm_to_actual = {norm_col(c): c for c in cols}
        c = next((norm_to_actual[k] for k in norm_to_actual if k in CUSTOMER_KEYS), None)
        p = next((norm_to_actual[k] for k in norm_to_actual if k in PERSON_KEYS), None)
        return c, p

    def parse_sheet(sheet_df):
        c, p = find_cols(sheet_df.columns)
        if not c or not p:
            raw = sheet_df.copy()
            raw.columns = range(len(raw.columns))
            for i in range(min(10, len(raw))):
                candidate = list(raw.iloc[i].astype(object))
                c2, p2 = find_cols(candidate)
                if c2 and p2:
                    sheet_df = sheet_df.iloc[i+1:].copy()
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

    try:
        file_bytes = f.read()
        sheets = pd.read_excel(io.BytesIO(file_bytes), sheet_name=None)
    except Exception as e:
        return jsonify({"error": f"Failed to parse Excel: {e}"}), 400

    all_records: list[dict] = []
    sheets_used: list[str] = []
    sheets_skipped: list[dict] = []
    target_sheet_key = "customerlistwithsalesperson"
    sheets_to_parse = {
        sheet_name: df
        for sheet_name, df in sheets.items()
        if norm_col(sheet_name) == target_sheet_key
    }
    if not sheets_to_parse:
        return jsonify({
            "error": "Expected sheet 'Customer List With Sales Person' not found.",
            "sheets_found": list(sheets.keys()),
        }), 400

    for sheet_name, df in sheets_to_parse.items():
        recs, c, p = parse_sheet(df)
        if recs:
            all_records.extend(recs)
            sheets_used.append(f"{sheet_name} ({len(recs)} rows)")
        else:
            sheets_skipped.append({"sheet": sheet_name, "columns": [str(x) for x in df.columns]})
    for sheet_name, df in sheets.items():
        if sheet_name not in sheets_to_parse:
            sheets_skipped.append({"sheet": sheet_name, "columns": [str(x) for x in df.columns]})

    if not all_records:
        return jsonify({
            "error": (
                "No sheet had both a customer-name and a sales-person column. "
                f"Checked sheets: {[s['sheet'] for s in sheets_skipped]}"
            ),
            "sheets_skipped": sheets_skipped,
        }), 400

    records_by_key: dict[str, dict] = {}
    duplicates_replaced = 0
    for r in all_records:
        key = customer_key(r["customer_name"])
        if not key:
            continue
        if key in records_by_key and records_by_key[key]["sales_person"] != r["sales_person"]:
            duplicates_replaced += 1
        records_by_key[key] = r
    records = list(records_by_key.values())

    if not records:
        return jsonify({"error": "No valid customer/salesperson rows found"}), 400

    try:
        with db.connect() as conn, conn.cursor() as cur:
            cur.execute(sql.SQL("TRUNCATE TABLE {tbl}").format(tbl=sql.Identifier(SALESPERSON_TABLE)))
            _insert_records(cur, SALESPERSON_TABLE, records)
    except Exception as e:
        return jsonify({"error": f"Insert failed: {e}"}), 500

    _cache["payload"] = None
    _cache["fetched_at"] = 0.0

    return jsonify({
        "inserted": len(records),
        "duplicates_replaced": duplicates_replaced,
        "sheets_used": sheets_used,
        "sheets_skipped": [s["sheet"] for s in sheets_skipped],
        "filename": f.filename,
    })


def _insert_records(cur, table: str, records: list[dict]) -> None:
    if not records:
        return
    cols = list(records[0].keys())
    stmt = sql.SQL("INSERT INTO {table} ({cols}) VALUES ({placeholders})").format(
        table=sql.Identifier(table),
        cols=sql.SQL(", ").join(sql.Identifier(c) for c in cols),
        placeholders=sql.SQL(", ").join(sql.Placeholder(c) for c in cols),
    )
    cur.executemany(stmt, records)


@app.get("/")
def index():
    return send_from_directory(HERE, "index.html")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=True)
