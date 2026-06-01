from flask import jsonify

from app.domain.auth import change_own_password, current_user, user_roles
from app.web.web_helpers import admin_error, json_body


def register_profile_routes(app) -> None:
    @app.get("/api/profile")
    def api_profile():
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
