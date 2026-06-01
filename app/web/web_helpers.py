import logging

from flask import jsonify, request

logger = logging.getLogger(__name__)


def json_body() -> dict:
    return request.get_json(silent=True) or {}


def admin_error(e: Exception, status: int = 400):
    if isinstance(e, (ValueError, PermissionError)):
        # Expected, user-facing errors from business logic (auth.py, etc.)
        return jsonify({"error": str(e)}), status
    # Unexpected errors — never leak stack traces or internal details to clients
    logger.exception("Unexpected error in admin endpoint")
    return jsonify({"error": "Operation failed. Please try again or contact an administrator."}), 500


def register_security_headers(app) -> None:
    @app.after_request
    def _security_headers(resp):
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

        # Basic security headers (safe, low-risk addition)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' https://cdn.jsdelivr.net; "
            "script-src-attr 'none'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "font-src 'self' data:; "
            "connect-src 'self'; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'",
        )
        return resp
