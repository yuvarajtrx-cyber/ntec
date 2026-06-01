import calendar
import re
import tempfile
from datetime import date, timedelta

import pandas as pd
from flask import jsonify, request
from psycopg import sql

from app.data import db
from app.domain.auth import log_audit, permission_required
from app.domain.customers import customer_key
from app.data.data_access import (
    DataSourceError,
    SALESPERSON_TABLE,
    TABLE_NAME,
    fetch_latest_voucher_date,
    insert_records,
)
from app.domain.sales_data import get_cached_payload, invalidate_cache
from app.ingest.salesperson_excel import TARGET_SHEET_KEY, norm_col, parse_sheet
from app.ingest.upload import LINE_ITEM_TABLE, parse_workbook


_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_VALID_PRESETS = {"month", "lastmonth", "year", "lastyear", "all"}


def _month_bounds(year: int, month: int) -> tuple[str, str]:
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1).isoformat(), date(year, month, last_day).isoformat()


def _year_bounds(year: int) -> tuple[str, str]:
    return date(year, 1, 1).isoformat(), date(year, 12, 31).isoformat()


def _resolve_preset(preset: str) -> tuple[str | None, str | None]:
    """Map a preset name to (from, to) anchored on the latest voucher_date.

    The table can hold years of historical data, so anchoring on today's
    calendar would make the "Latest Month" default land in an empty window.
    Anchoring on max(voucher_date) means the default always shows real data.
    """
    if preset == "all":
        return None, None
    anchor_iso = fetch_latest_voucher_date()
    anchor = date.fromisoformat(anchor_iso) if anchor_iso else date.today()
    if preset == "month":
        return _month_bounds(anchor.year, anchor.month)
    if preset == "lastmonth":
        prev_month_last = date(anchor.year, anchor.month, 1) - timedelta(days=1)
        return _month_bounds(prev_month_last.year, prev_month_last.month)
    if preset == "year":
        return _year_bounds(anchor.year)
    if preset == "lastyear":
        return _year_bounds(anchor.year - 1)
    # Fallback: same as "month".
    return _month_bounds(anchor.year, anchor.month)


def _parse_range_param(value: str | None) -> str | None:
    if not value:
        return None
    if not _ISO_DATE_RE.match(value):
        raise ValueError(f"Invalid date '{value}', expected YYYY-MM-DD")
    return value


def register_sales_routes(app) -> None:
    @app.get("/api/sales")
    @permission_required("sales.view")
    def api_sales():
        preset = (request.args.get("preset") or "").strip().lower()
        try:
            if preset:
                if preset not in _VALID_PRESETS:
                    return jsonify({"error": f"Unknown preset '{preset}'"}), 400
                date_from, date_to = _resolve_preset(preset)
            else:
                date_from = _parse_range_param(request.args.get("from"))
                date_to = _parse_range_param(request.args.get("to"))
                if date_from is None and date_to is None:
                    # No params and no preset → default to latest month with data.
                    date_from, date_to = _resolve_preset("month")
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        try:
            payload = get_cached_payload(date_from, date_to)
        except DataSourceError as e:
            return jsonify({"error": str(e)}), 503
        if preset:
            payload = {**payload, "range": {**payload.get("range", {}), "preset": preset}}
        return jsonify(payload)

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

        # mode: "skip" (default) inserts only new voucher_nos.
        #       "replace" deletes existing rows for matching voucher_nos, then inserts.
        mode = (request.args.get("mode") or request.form.get("mode") or "skip").lower()
        if mode not in {"skip", "replace"}:
            mode = "skip"

        # Dedupe within the uploaded file itself: same voucher_no twice in one Excel
        # should be treated as one row, not two.
        seen_in_file: set[str] = set()
        file_duplicates: list[str] = []
        deduped_vouchers: list[dict] = []
        for v in vouchers:
            vno = v.get("voucher_no")
            if not vno:
                continue
            if vno in seen_in_file:
                file_duplicates.append(vno)
                continue
            seen_in_file.add(vno)
            deduped_vouchers.append(v)

        # Compare against what's already in the DB.
        incoming_vnos = [v["voucher_no"] for v in deduped_vouchers]
        try:
            existing_rows = db.fetch_all(
                f"SELECT voucher_no FROM {TABLE_NAME} WHERE voucher_no = ANY(%s)",
                (incoming_vnos,),
            ) if incoming_vnos else []
        except Exception as e:
            return jsonify({"error": f"DB lookup failed: {e}"}), 500
        existing_vnos = {r["voucher_no"] for r in existing_rows}

        new_vouchers = [v for v in deduped_vouchers if v["voucher_no"] not in existing_vnos]
        dup_vouchers = [v for v in deduped_vouchers if v["voucher_no"] in existing_vnos]
        dup_sample = sorted(existing_vnos)[:10]

        try:
            with db.connect() as conn, conn.cursor() as cur:
                if mode == "replace" and existing_vnos:
                    cur.execute(
                        f"DELETE FROM {LINE_ITEM_TABLE} WHERE voucher_no = ANY(%s)",
                        (list(existing_vnos),),
                    )
                    cur.execute(
                        f"DELETE FROM {TABLE_NAME} WHERE voucher_no = ANY(%s)",
                        (list(existing_vnos),),
                    )
                    vouchers_to_insert = deduped_vouchers
                    kept_vnos = set(incoming_vnos)
                else:
                    vouchers_to_insert = new_vouchers
                    kept_vnos = {v["voucher_no"] for v in new_vouchers}

                line_items_to_insert = [li for li in line_items if li.get("voucher_no") in kept_vnos]
                insert_records(cur, TABLE_NAME, vouchers_to_insert)
                insert_records(cur, LINE_ITEM_TABLE, line_items_to_insert)
        except Exception as e:
            return jsonify({
                "error": f"Insert failed: {e}",
                "inserted": 0,
            }), 500

        invalidate_cache()
        log_audit(
            "sales.upload",
            target_type="sales_register",
            detail={
                "filename": f.filename,
                "inserted": len(vouchers_to_insert),
                "line_items_inserted": len(line_items_to_insert),
                "skipped_duplicates": len(dup_vouchers),
                "mode": mode,
            },
        )

        return jsonify({
            "inserted": len(vouchers_to_insert),
            "line_items_inserted": len(line_items_to_insert),
            "skipped_duplicates": len(dup_vouchers),
            "file_internal_duplicates": len(file_duplicates),
            "duplicate_samples": dup_sample,
            "rows_in_file": len(df),
            "mode": mode,
            "filename": f.filename,
        })

    @app.post("/api/upload-salespersons")
    @permission_required("salesperson_map.upload")
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

        # Dedupe across sheets by normalized customer name. Later sheets win because
        # the workbook's detailed "Customer List With Sales Person" sheet should
        # override older summary/debtor sheets when they disagree.
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

        try:
            with db.connect() as conn, conn.cursor() as cur:
                cur.execute(sql.SQL("TRUNCATE TABLE {tbl}").format(tbl=sql.Identifier(SALESPERSON_TABLE)))
                insert_records(cur, SALESPERSON_TABLE, records)
        except Exception as e:
            return jsonify({"error": f"Insert failed: {e}"}), 500

        invalidate_cache()
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
