

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


def customer_key(name) -> str:
    """Normalize a customer name for joining transactions ↔ mapping.

    Lowercases, strips punctuation, collapses whitespace. Conservative — does
    NOT expand abbreviations (Pvt vs Private), since those collapses can
    accidentally merge distinct companies.
    """
    if not name:
        return ""
    s = str(name).lower()
    s = re.sub(r"[.,;:'\"()\[\]/\\\-_]", " ", s)
    s = re.sub(r"&", " and ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def fetch_salesperson_map() -> dict[str, str]:
    """normalized customer_name -> sales_person."""
    try:
        rows = db.fetch_all(f"SELECT customer_name, sales_person FROM {SALESPERSON_TABLE}")
    except Exception:
        return {}
    out: dict[str, str] = {}
    for r in rows:
        key = customer_key(r.get("customer_name"))
        person = (r.get("sales_person") or "").strip()
        if key and person:
            out[key] = person
    return out


def fetch_line_items() -> dict[str, list[dict]]:
    """Return product line items grouped by voucher_no."""
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
        key = customer_key(row.get("particulars"))
        row["sales_person"] = salesperson_by_customer.get(key, "Unassigned")
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

    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=True) as tmp:
        f.save(tmp.name)
        try:
            df = pd.read_excel(tmp.name)
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
    """Accept a salesperson-mapping Excel and FULLY REPLACE the table.

    Expected columns: 'CUSTOMER NAME' and 'Sales Person' (case-insensitive,
    extra columns like 'S.No' are ignored).
    """
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

    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=True) as tmp:
        f.save(tmp.name)
        try:
            # First try the default (row 0 = header).
            df = pd.read_excel(tmp.name)
            customer_col, person_col = find_cols(df.columns)
            # Fall back: scan first 10 rows for a header row that contains both columns.
            if not customer_col or not person_col:
                raw = pd.read_excel(tmp.name, header=None)
                for i in range(min(10, len(raw))):
                    candidate = list(raw.iloc[i].astype(object))
                    c, p = find_cols(candidate)
                    if c and p:
                        df = pd.read_excel(tmp.name, header=i)
                        customer_col, person_col = find_cols(df.columns)
                        break
        except Exception as e:
            return jsonify({"error": f"Failed to parse Excel: {e}"}), 400

    if not customer_col or not person_col:
        found = [str(c) for c in df.columns]
        return jsonify({
            "error": (
                "Expected columns 'Customer Name' and 'Sales Person' not found. "
                f"Found columns: {found}"
            ),
            "found_columns": found,
        }), 400

    records: list[dict] = []
    seen: set[str] = set()
    for _, raw in df.iterrows():
        name = str(raw.get(customer_col) or "").strip()
        person = str(raw.get(person_col) or "").strip()
        if not name or not person or name.lower() == "nan" or person.lower() == "nan":
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        records.append({"customer_name": name, "sales_person": person})

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
