import tempfile
import time
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from psycopg import sql

from auth import (
    PAGE_PERMISSIONS,
    any_permission_required,
    create_department,
    create_role,
    create_user,
    init_auth,
    change_own_password,
    list_audit_logs,
    list_departments,
    list_roles,
    list_users,
    log_audit,
    permission_required,
    permissions_payload,
    register_auth_routes,
    set_user_password,
    update_department,
    update_role,
    update_user,
)
import db
from classify import classify
from customers import customer_key, resolve_salesperson
from data_access import (
    DataSourceError,
    SALESPERSON_TABLE,
    TABLE_NAME,
    fetch_line_items,
    fetch_salesperson_map,
    from_db,
    insert_records,
)
from location import parse_location
from salesperson_excel import TARGET_SHEET_KEY, norm_col, parse_sheet
from text_utils import clean_excel_text, clean_val
from upload import LINE_ITEM_TABLE, parse_workbook

HERE = Path(__file__).parent
CACHE_TTL_SEC = 60

load_dotenv()
app = Flask(__name__, static_folder=None)
init_auth(app)
register_auth_routes(app)
_cache = {"payload": None, "fetched_at": 0.0}


@app.after_request
def no_cache_app_shell(resp):
    if (
        request.path == "/"
        or request.path.startswith("/js/")
        or request.path.startswith("/css/")
        or request.path.startswith("/pages/")
        or request.path == "/api/session"
    ):
        resp.headers["Cache-Control"] = "no-store, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
    return resp


def _invalidate_cache() -> None:
    _cache["payload"] = None
    _cache["fetched_at"] = 0.0


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
@any_permission_required(PAGE_PERMISSIONS)
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
@permission_required("sales.upload")
def api_upload():
    """Accept an Excel file, clean it, and insert into Postgres."""
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "No file provided"}), 400
    if not f.filename.lower().endswith((".xlsx", ".xls")):
        return jsonify({"error": "File must be .xlsx or .xls"}), 400

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
            insert_records(cur, TABLE_NAME, vouchers)
            insert_records(cur, LINE_ITEM_TABLE, line_items)
    except Exception as e:
        return jsonify({
            "error": f"Insert failed: {e}",
            "inserted": 0,
        }), 500

    _invalidate_cache()
    log_audit(
        "sales.upload",
        target_type="sales_register",
        detail={
            "filename": f.filename,
            "inserted": len(vouchers),
            "line_items_inserted": len(line_items),
        },
    )

    return jsonify({
        "inserted": len(vouchers),
        "line_items_inserted": len(line_items),
        "rows_in_file": len(df),
        "filename": f.filename,
    })


@app.post("/api/upload-salespersons")
@permission_required("salesperson_map.upload")
def api_upload_salespersons():
    """Accept a salesperson-mapping Excel and FULLY REPLACE the table."""
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "No file provided"}), 400
    if not f.filename.lower().endswith((".xlsx", ".xls")):
        return jsonify({"error": "File must be .xlsx or .xls"}), 400

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=True) as tmp:
        f.save(tmp.name)
        try:
            sheets = pd.read_excel(tmp.name, sheet_name=None)
        except Exception as e:
            return jsonify({"error": f"Failed to parse Excel: {e}"}), 400

    all_records: list[dict] = []
    sheets_used: list[str] = []
    sheets_skipped: list[dict] = []
    sheets_to_parse = {
        sheet_name: df
        for sheet_name, df in sheets.items()
        if norm_col(sheet_name) == TARGET_SHEET_KEY
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
            insert_records(cur, SALESPERSON_TABLE, records)
    except Exception as e:
        return jsonify({"error": f"Insert failed: {e}"}), 500

    _invalidate_cache()
    log_audit(
        "salesperson_map.upload",
        target_type="customer_salesperson",
        detail={"filename": f.filename, "inserted": len(records)},
    )

    return jsonify({
        "inserted": len(records),
        "duplicates_replaced": duplicates_replaced,
        "sheets_used": sheets_used,
        "sheets_skipped": [s["sheet"] for s in sheets_skipped],
        "filename": f.filename,
    })


def json_body() -> dict:
    return request.get_json(silent=True) or {}


def admin_error(e: Exception, status: int = 400):
    return jsonify({"error": str(e)}), status


@app.get("/api/profile")
def api_profile():
    from auth import current_user, user_roles

    user = current_user()
    return jsonify({
        "user": {
            "id": user["id"],
            "username": user["username"],
            "displayName": user["display_name"],
            "department": user.get("department_name"),
            "roles": user_roles(user["id"]),
        }
    })


@app.post("/api/profile/password")
def api_profile_password():
    try:
        body = json_body()
        change_own_password(body.get("currentPassword", ""), body.get("newPassword", ""))
        return jsonify({"ok": True})
    except Exception as e:
        return admin_error(e)


@app.get("/api/admin/permissions")
@permission_required("admin.view")
def api_admin_permissions():
    return jsonify({"permissions": permissions_payload()})


@app.get("/api/admin/audit-log")
@permission_required("admin.view")
def api_admin_audit_log():
    return jsonify({"logs": list_audit_logs(request.args.get("limit", 100))})


@app.get("/api/admin/users")
@permission_required("users.manage")
def api_admin_users():
    return jsonify({"users": list_users()})


@app.post("/api/admin/users")
@permission_required("users.manage")
def api_admin_create_user():
    try:
        return jsonify({"user": create_user(json_body())}), 201
    except Exception as e:
        return admin_error(e)


@app.patch("/api/admin/users/<int:user_id>")
@permission_required("users.manage")
def api_admin_update_user(user_id: int):
    try:
        return jsonify({"user": update_user(user_id, json_body())})
    except Exception as e:
        return admin_error(e)


@app.post("/api/admin/users/<int:user_id>/password")
@permission_required("users.manage")
def api_admin_set_password(user_id: int):
    try:
        set_user_password(user_id, json_body().get("password", ""))
        return jsonify({"ok": True})
    except Exception as e:
        return admin_error(e)


@app.get("/api/admin/roles")
@any_permission_required(("roles.manage", "users.manage"))
def api_admin_roles():
    return jsonify({"roles": list_roles()})


@app.post("/api/admin/roles")
@permission_required("roles.manage")
def api_admin_create_role():
    try:
        return jsonify({"role": create_role(json_body())}), 201
    except Exception as e:
        return admin_error(e)


@app.patch("/api/admin/roles/<int:role_id>")
@permission_required("roles.manage")
def api_admin_update_role(role_id: int):
    try:
        return jsonify({"role": update_role(role_id, json_body())})
    except Exception as e:
        return admin_error(e)


@app.get("/api/admin/departments")
@any_permission_required(("departments.manage", "users.manage"))
def api_admin_departments():
    return jsonify({"departments": list_departments()})


@app.post("/api/admin/departments")
@permission_required("departments.manage")
def api_admin_create_department():
    try:
        return jsonify({"department": create_department(json_body())}), 201
    except Exception as e:
        return admin_error(e)


@app.patch("/api/admin/departments/<int:department_id>")
@permission_required("departments.manage")
def api_admin_update_department(department_id: int):
    try:
        return jsonify({"department": update_department(department_id, json_body())})
    except Exception as e:
        return admin_error(e)


@app.get("/")
def index():
    return send_from_directory(HERE, "index.html")


@app.get("/css/<path:filename>")
def css_file(filename):
    return send_from_directory(HERE / "css", filename)


@app.get("/js/<path:filename>")
def js_file(filename):
    return send_from_directory(HERE / "js", filename)


@app.get("/pages/<path:filename>")
def page_file(filename):
    return send_from_directory(HERE / "pages", filename)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=True)
