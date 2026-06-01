from flask import jsonify, request

from app.domain.auth import (
    any_permission_required,
    create_department,
    create_role,
    create_user,
    delete_department,
    delete_role,
    delete_user,
    list_audit_logs,
    list_departments,
    list_roles,
    list_users,
    permission_required,
    permissions_payload,
    set_user_password,
    update_department,
    update_role,
    update_user,
)
from app.web.web_helpers import admin_error, json_body


def register_admin_routes(app) -> None:
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

    @app.delete("/api/admin/users/<int:user_id>")
    @permission_required("users.manage")
    def api_admin_delete_user(user_id: int):
        try:
            delete_user(user_id)
            return jsonify({"ok": True})
        except Exception as e:
            return admin_error(e)

    @app.get("/api/admin/roles")
    @any_permission_required(("roles.manage", "users.manage", "quality.workflow.manage"))
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

    @app.delete("/api/admin/roles/<int:role_id>")
    @permission_required("roles.manage")
    def api_admin_delete_role(role_id: int):
        try:
            delete_role(role_id)
            return jsonify({"ok": True})
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

    @app.delete("/api/admin/departments/<int:department_id>")
    @permission_required("departments.manage")
    def api_admin_delete_department(department_id: int):
        try:
            delete_department(department_id)
            return jsonify({"ok": True})
        except Exception as e:
            return admin_error(e)
