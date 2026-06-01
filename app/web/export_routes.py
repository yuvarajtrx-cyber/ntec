from __future__ import annotations

from datetime import datetime

from flask import jsonify, request, send_file

from app.domain.auth import current_user, has_permission, is_authenticated, log_audit
from app.ingest.export_reports import build_excel_report, build_pdf_report, safe_filename


PAGE_EXPORT_PERMISSIONS = {
    "home": "page.home",
    "analysis": "page.analysis",
    "kpi": "page.kpi",
    "products": "page.products",
    "sales-team": "page.sales_team",
    "customers": "page.customers",
    "records": "page.records",
}


def register_export_routes(app) -> None:
    @app.post("/api/export/excel")
    def export_excel():
        payload, error, status = _validated_payload()
        if error:
            return jsonify({"error": error}), status
        out = build_excel_report(payload)
        filename = safe_filename(payload.get("title") or "ntec-report", "xlsx")
        _log_export("export.excel", payload)
        return send_file(
            out,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name=filename,
        )

    @app.post("/api/export/pdf")
    def export_pdf():
        payload, error, status = _validated_payload()
        if error:
            return jsonify({"error": error}), status
        out = build_pdf_report(payload)
        filename = safe_filename(payload.get("title") or "ntec-report", "pdf")
        _log_export("export.pdf", payload)
        return send_file(
            out,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=filename,
        )


def _validated_payload() -> tuple[dict, str | None, int]:
    if not is_authenticated():
        return {}, "Authentication required", 401
    payload = request.get_json(silent=True) or {}
    page = payload.get("page")
    permission = PAGE_EXPORT_PERMISSIONS.get(page)
    if not permission:
        return {}, "Unknown export page", 400
    if not has_permission(permission):
        return {}, "Permission denied", 403
    payload["generatedAt"] = datetime.now().isoformat(timespec="seconds")
    user = current_user() or {}
    payload["generatedBy"] = user.get("display_name") or user.get("username") or "System"
    return payload, None, 200


def _log_export(action: str, payload: dict) -> None:
    sections = payload.get("sections") or []
    row_count = 0
    for section in sections:
        if isinstance(section, dict):
            row_count += len(section.get("rows") or [])
    log_audit(
        action,
        target_type="report",
        target_id=payload.get("page"),
        detail={"title": payload.get("title"), "rows": row_count},
    )
