import os
import secrets
import time
from datetime import timedelta
from functools import wraps

from flask import (
    g,
    jsonify,
    redirect,
    render_template_string,
    request,
    session,
    url_for,
)
from psycopg import sql
from werkzeug.security import check_password_hash, generate_password_hash
from psycopg.types.json import Jsonb

from app.data import db

AUTH_USER_ID_KEY = "auth_user_id"
CSRF_KEY = "csrf_token"
LOGIN_WINDOW_SEC = 15 * 60
MAX_LOGIN_ATTEMPTS = 5
ADMIN_ROLE_NAME = "Admin"
MAX_SHORT_TEXT_LEN = 200
MAX_LONG_TEXT_LEN = 1000
SYSTEM_ADMIN_PERMISSIONS = {
    "admin.view",
    "users.manage",
    "roles.manage",
    "departments.manage",
}

PAGE_PERMISSIONS = {
    "page.home",
    "page.analysis",
    "page.kpi",
    "page.products",
    "page.sales_team",
    "page.customers",
    "page.records",
    "page.quality_tracker",
    "admin.view",
}

DEFAULT_PERMISSIONS = [
    ("page.home", "Home", "Pages"),
    ("page.analysis", "Analysis", "Pages"),
    ("page.kpi", "KPI", "Pages"),
    ("page.products", "Products", "Pages"),
    ("page.sales_team", "Sales Team", "Pages"),
    ("page.customers", "Customers", "Pages"),
    ("page.records", "Records List", "Pages"),
    ("page.quality_tracker", "Quality Tracker", "Pages"),
    ("admin.view", "Admin", "Pages"),
    ("sales.view", "View Sales Data", "Actions"),
    ("sales.upload", "Upload Sales", "Actions"),
    ("salesperson_map.upload", "Upload Salesperson Map", "Actions"),
    ("quality.raise", "Raise Quality Queries", "Quality"),
    ("quality.review", "Review Quality Queries", "Quality"),
    ("quality.approve", "Approve / Reject Quality Queries", "Quality"),
    ("quality.close", "Close Quality Queries", "Quality"),
    ("quality.workflow.manage", "Manage Quality Workflows", "Quality"),
    ("users.manage", "Manage Users", "Admin"),
    ("roles.manage", "Manage Roles", "Admin"),
    ("departments.manage", "Manage Departments", "Admin"),
]

_login_attempts: dict[str, list[float]] = {}


LOGIN_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>NTEC Sign in</title>
<style>
:root {
  --bg: #f6f7fb;
  --card: #ffffff;
  --text: #111827;
  --muted: #6b7280;
  --border: #d7dce5;
  --accent: #4f46e5;
  --danger: #dc2626;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.login-panel {
  width: min(420px, calc(100vw - 32px));
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
  padding: 28px;
}
h1 { margin: 0 0 6px; font-size: 22px; font-weight: 650; }
p { margin: 0 0 22px; color: var(--muted); font-size: 14px; }
label { display: block; margin-bottom: 14px; font-size: 13px; font-weight: 600; }
input {
  width: 100%;
  margin-top: 7px;
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font: inherit;
  color: var(--text);
  background: #fff;
}
input:focus {
  outline: 2px solid rgba(79, 70, 229, 0.18);
  border-color: var(--accent);
}
button {
  width: 100%;
  margin-top: 6px;
  padding: 11px 14px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}
.error {
  display: {{ "block" if error else "none" }};
  margin-bottom: 14px;
  color: var(--danger);
  font-size: 13px;
  font-weight: 600;
}
</style>
</head>
<body>
  <form class="login-panel" method="post" action="{{ url_for('login') }}">
    <h1>Sign in to NTEC</h1>
    <p>Use your NTEC dashboard credentials to continue.</p>
    <div class="error">{{ error }}</div>
    <label>
      Username
      <input name="username" autocomplete="username" required autofocus />
    </label>
    <label>
      Password
      <input name="password" type="password" autocomplete="current-password" required />
    </label>
    <input type="hidden" name="next" value="{{ next_url }}" />
    <button type="submit">Sign in</button>
  </form>
</body>
</html>"""


def init_auth(app) -> None:
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        secret_key = secrets.token_hex(32)
        app.logger.warning("SECRET_KEY is not set; sessions will reset when the server restarts.")

    app.secret_key = secret_key
    app.permanent_session_lifetime = timedelta(
        hours=float(os.environ.get("AUTH_SESSION_HOURS", "12"))
    )
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("AUTH_COOKIE_SECURE", "false").lower() == "true",
    )
    ensure_auth_store(app)


def ensure_auth_store(app=None) -> None:
    """Create and seed auth tables idempotently."""
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.app_department (
                id bigserial PRIMARY KEY,
                name text NOT NULL UNIQUE,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.app_role (
                id bigserial PRIMARY KEY,
                name text NOT NULL UNIQUE,
                description text NOT NULL DEFAULT '',
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.app_permission (
                key text PRIMARY KEY,
                label text NOT NULL,
                category text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.app_user (
                id bigserial PRIMARY KEY,
                username text NOT NULL UNIQUE,
                password_hash text NOT NULL,
                display_name text NOT NULL DEFAULT '',
                department_id bigint REFERENCES public.app_department(id) ON DELETE SET NULL,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.app_role_permission (
                role_id bigint NOT NULL REFERENCES public.app_role(id) ON DELETE CASCADE,
                permission_key text NOT NULL REFERENCES public.app_permission(key) ON DELETE CASCADE,
                PRIMARY KEY (role_id, permission_key)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.app_user_role (
                user_id bigint NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
                role_id bigint NOT NULL REFERENCES public.app_role(id) ON DELETE CASCADE,
                PRIMARY KEY (user_id, role_id)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS app_user_department_idx ON public.app_user (department_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS app_role_permission_perm_idx ON public.app_role_permission (permission_key)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.app_audit_log (
                id bigserial PRIMARY KEY,
                actor_user_id bigint REFERENCES public.app_user(id) ON DELETE SET NULL,
                actor_username text,
                action text NOT NULL,
                target_type text,
                target_id text,
                detail jsonb NOT NULL DEFAULT '{}'::jsonb,
                ip_address text,
                created_at timestamptz NOT NULL DEFAULT now()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS app_audit_log_created_idx ON public.app_audit_log (created_at DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS app_audit_log_action_idx ON public.app_audit_log (action)")

        for key, label, category in DEFAULT_PERMISSIONS:
            cur.execute(
                """
                INSERT INTO public.app_permission (key, label, category)
                VALUES (%s, %s, %s)
                ON CONFLICT (key) DO UPDATE
                SET label = EXCLUDED.label, category = EXCLUDED.category
                """,
                (key, label, category),
            )

        cur.execute(
            """
            SELECT 1
            FROM public.app_audit_log
            WHERE action = 'migration.sales_view_existing_page_roles'
            LIMIT 1
            """
        )
        if not cur.fetchone():
            cur.execute(
                """
                INSERT INTO public.app_role_permission (role_id, permission_key)
                SELECT DISTINCT role_id, 'sales.view'
                FROM public.app_role_permission
                WHERE permission_key LIKE 'page.%'
                ON CONFLICT DO NOTHING
                """
            )
            cur.execute(
                """
                INSERT INTO public.app_audit_log (action, target_type, target_id, detail)
                VALUES (%s, %s, %s, %s)
                """,
                (
                    "migration.sales_view_existing_page_roles",
                    "app_role_permission",
                    "sales.view",
                    Jsonb({"reason": "Preserve sales data access for existing page roles"}),
                ),
            )

        cur.execute(
            """
            INSERT INTO public.app_department (name)
            VALUES ('Management')
            ON CONFLICT (name) DO NOTHING
            """
        )
        cur.execute(
            """
            INSERT INTO public.app_role (name, description)
            VALUES ('Admin', 'Full system access')
            ON CONFLICT (name) DO UPDATE
            SET description = EXCLUDED.description, is_active = true, updated_at = now()
            RETURNING id
            """
        )
        admin_role_id = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO public.app_role_permission (role_id, permission_key) "
            "SELECT %s, key FROM public.app_permission "
            "ON CONFLICT DO NOTHING",
            (admin_role_id,),
        )

        username = os.environ.get("AUTH_USERNAME", "admin").strip() or "admin"
        password_hash = os.environ.get("AUTH_PASSWORD_HASH", "")
        if not password_hash and app:
            app.logger.warning("AUTH_PASSWORD_HASH is not set; no bootstrap admin was created.")
            return
        if password_hash:
            cur.execute("SELECT id FROM public.app_department WHERE name = 'Management'")
            dept_id = cur.fetchone()["id"]
            cur.execute(
                """
                INSERT INTO public.app_user (username, password_hash, display_name, department_id)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (username) DO UPDATE
                SET password_hash = CASE
                        WHEN app_user.password_hash = '' THEN EXCLUDED.password_hash
                        ELSE public.app_user.password_hash
                    END,
                    is_active = true,
                    updated_at = now()
                RETURNING id
                """,
                (username, password_hash, username, dept_id),
            )
            user_id = cur.fetchone()["id"]
            cur.execute(
                """
                INSERT INTO public.app_user_role (user_id, role_id)
                VALUES (%s, %s)
                ON CONFLICT DO NOTHING
                """,
                (user_id, admin_role_id),
            )


def register_auth_routes(app) -> None:
    @app.before_request
    def require_login():
        endpoint = request.endpoint or ""
        if endpoint in {"login", "logout", "session_info"}:
            return None
        if endpoint == "static":
            return None
        if is_authenticated():
            return None
        if request.path.startswith("/api/"):
            return jsonify({"error": "Authentication required"}), 401
        return redirect(url_for("login", next=request.full_path if request.query_string else request.path))

    @app.before_request
    def require_csrf():
        if request.method in {"GET", "HEAD", "OPTIONS"}:
            return None
        if request.endpoint in {"login", "logout"}:
            return None
        if not is_authenticated():
            return None
        token = request.headers.get("X-CSRF-Token")
        if not token or not secrets.compare_digest(token, session.get(CSRF_KEY, "")):
            return jsonify({"error": "Invalid CSRF token"}), 403
        return None

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "GET":
            if is_authenticated():
                return redirect(safe_next_url(request.args.get("next")))
            return render_login()

        if is_rate_limited():
            return render_login("Too many login attempts. Try again in a few minutes."), 429

        username = request.form.get("username", "")
        password = request.form.get("password", "")
        user = verify_credentials(username, password)
        if user:
            session.clear()
            session.permanent = True
            session[AUTH_USER_ID_KEY] = user["id"]
            session[CSRF_KEY] = secrets.token_urlsafe(32)
            clear_attempts()
            log_audit("auth.login", actor=user, target_type="user", target_id=user["id"])
            return redirect(safe_next_url(request.form.get("next")))

        record_failed_attempt()
        log_audit(
            "auth.login_failed",
            actor_username=username,
            detail={"username": username},
        )
        return render_login("Invalid username or password."), 401

    @app.post("/logout")
    def logout():
        user = current_user()
        if user:
            log_audit("auth.logout", actor=user, target_type="user", target_id=user["id"])
        session.clear()
        return redirect(url_for("login"))

    @app.get("/api/session")
    def session_info():
        if not is_authenticated():
            return jsonify({"authenticated": False}), 401
        user = current_user()
        return jsonify({
            "authenticated": True,
            "id": user["id"],
            "username": user["username"],
            "displayName": user["display_name"],
            "department": user.get("department_name"),
            "roles": user_roles(user["id"]),
            "permissions": user_permissions(user["id"]),
            "csrfToken": session.get(CSRF_KEY),
        })


def login_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not is_authenticated():
            return jsonify({"error": "Authentication required"}), 401
        return fn(*args, **kwargs)
    return wrapped


def is_authenticated() -> bool:
    return current_user() is not None


def render_login(error: str = ""):
    return render_template_string(
        LOGIN_HTML,
        error=error,
        next_url=safe_next_url(request.args.get("next") or request.form.get("next")),
    )


def verify_credentials(username: str, password: str) -> dict | None:
    username = (username or "").strip()
    if not username or not password:
        return None
    row = db.fetch_all(
        """
        SELECT u.id, u.username, u.password_hash, u.display_name, u.is_active
        FROM public.app_user u
        WHERE lower(u.username) = lower(%s)
        """,
        (username,),
    )
    if not row:
        return None
    user = row[0]
    if not user["is_active"]:
        return None
    if not check_password_hash(user["password_hash"], password):
        return None
    return user


def current_user() -> dict | None:
    if hasattr(g, "_auth_user"):
        return g._auth_user
    user_id = session.get(AUTH_USER_ID_KEY)
    if not user_id:
        g._auth_user = None
        return None
    rows = db.fetch_all(
        """
        SELECT u.id, u.username, u.display_name, u.department_id, u.is_active,
               d.name AS department_name
        FROM public.app_user u
        LEFT JOIN public.app_department d ON d.id = u.department_id
        WHERE u.id = %s
        """,
        (user_id,),
    )
    if not rows or not rows[0]["is_active"]:
        session.clear()
        g._auth_user = None
        return None
    g._auth_user = rows[0]
    return g._auth_user


def user_roles(user_id: int) -> list[dict]:
    return db.fetch_all(
        """
        SELECT r.id, r.name, r.description
        FROM public.app_role r
        JOIN public.app_user_role ur ON ur.role_id = r.id
        WHERE ur.user_id = %s AND r.is_active = true
        ORDER BY r.name
        """,
        (user_id,),
    )


IMPLIED_PERMISSIONS: dict[str, str] = {
    "quality.raise": "page.quality_tracker",
    "quality.review": "page.quality_tracker",
    "quality.approve": "page.quality_tracker",
    "quality.close": "page.quality_tracker",
    "quality.workflow.manage": "page.quality_tracker",
}


def user_permissions(user_id: int) -> list[str]:
    rows = db.fetch_all(
        """
        SELECT DISTINCT rp.permission_key
        FROM public.app_user_role ur
        JOIN public.app_role r ON r.id = ur.role_id AND r.is_active = true
        JOIN public.app_role_permission rp ON rp.role_id = r.id
        WHERE ur.user_id = %s
        ORDER BY rp.permission_key
        """,
        (user_id,),
    )
    granted = {r["permission_key"] for r in rows}
    for source, implied in IMPLIED_PERMISSIONS.items():
        if source in granted:
            granted.add(implied)
    return sorted(granted)


def has_permission(permission: str) -> bool:
    user = current_user()
    return bool(user and permission in set(user_permissions(user["id"])))


def has_any_permission(permissions: set[str] | list[str] | tuple[str, ...]) -> bool:
    user = current_user()
    if not user:
        return False
    owned = set(user_permissions(user["id"]))
    return bool(owned.intersection(set(permissions)))


def permission_required(permission: str):
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if not is_authenticated():
                return jsonify({"error": "Authentication required"}), 401
            if not has_permission(permission):
                return jsonify({"error": "Permission denied", "permission": permission}), 403
            return fn(*args, **kwargs)
        return wrapped
    return decorator


def any_permission_required(permissions: set[str] | list[str] | tuple[str, ...]):
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if not is_authenticated():
                return jsonify({"error": "Authentication required"}), 401
            if not has_any_permission(permissions):
                return jsonify({"error": "Permission denied"}), 403
            return fn(*args, **kwargs)
        return wrapped
    return decorator


def permissions_payload() -> list[dict]:
    return db.fetch_all(
        """
        SELECT key, label, category
        FROM public.app_permission
        ORDER BY category, label
        """
    )


def list_departments(include_inactive: bool = True) -> list[dict]:
    if include_inactive:
        sql = """
            SELECT id, name, is_active
            FROM public.app_department
            ORDER BY is_active DESC, name
        """
        params = None
    else:
        sql = """
            SELECT id, name, is_active
            FROM public.app_department
            WHERE is_active = true
            ORDER BY is_active DESC, name
        """
        params = None
    return db.fetch_all(sql, params)


def list_roles(include_inactive: bool = True) -> list[dict]:
    if include_inactive:
        sql = """
            SELECT r.id, r.name, r.description, r.is_active,
                   COALESCE(array_agg(rp.permission_key ORDER BY rp.permission_key)
                            FILTER (WHERE rp.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
            FROM public.app_role r
            LEFT JOIN public.app_role_permission rp ON rp.role_id = r.id
            GROUP BY r.id
            ORDER BY r.is_active DESC, r.name
        """
        params = None
    else:
        sql = """
            SELECT r.id, r.name, r.description, r.is_active,
                   COALESCE(array_agg(rp.permission_key ORDER BY rp.permission_key)
                            FILTER (WHERE rp.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
            FROM public.app_role r
            LEFT JOIN public.app_role_permission rp ON rp.role_id = r.id
            WHERE r.is_active = true
            GROUP BY r.id
            ORDER BY r.is_active DESC, r.name
        """
        params = None
    roles = db.fetch_all(sql, params)
    for role in roles:
        role["permissions"] = list(role["permissions"] or [])
    return roles


def list_users() -> list[dict]:
    users = db.fetch_all(
        """
        SELECT u.id, u.username, u.display_name, u.department_id,
               d.name AS department_name, u.is_active, u.created_at, u.updated_at
        FROM public.app_user u
        LEFT JOIN public.app_department d ON d.id = u.department_id
        ORDER BY u.is_active DESC, u.username
        """
    )
    for user in users:
        user["roles"] = user_roles(user["id"])
    return users


def create_user(payload: dict) -> dict:
    username = clean_required(payload.get("username"), "username")
    password = clean_required(payload.get("password"), "password")
    display_name = clean_text(payload.get("displayName"), MAX_SHORT_TEXT_LEN, "display name") or username
    department_id = nullable_int(payload.get("departmentId"))
    role_ids = assignable_role_ids(int_list(payload.get("roleIds")), username)
    password_hash = generate_password_hash(password)
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.app_user (username, password_hash, display_name, department_id, is_active)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (username, password_hash, display_name, department_id, bool(payload.get("isActive", True))),
        )
        user_id = cur.fetchone()["id"]
        sync_user_roles(cur, user_id, role_ids)
    user = get_user(user_id)
    log_audit("user.create", target_type="user", target_id=user_id, detail={"username": username})
    return user


def update_user(user_id: int, payload: dict) -> dict:
    existing = get_user(user_id)
    is_system_admin = is_admin_username(existing["username"])
    fields = []
    params = []
    if "username" in payload and not is_system_admin:
        fields.append("username = %s")
        params.append(clean_required(payload.get("username"), "username"))
    if "displayName" in payload:
        fields.append("display_name = %s")
        params.append(clean_text(payload.get("displayName"), MAX_SHORT_TEXT_LEN, "display name"))
    if "departmentId" in payload:
        fields.append("department_id = %s")
        params.append(nullable_int(payload.get("departmentId")))
    if "isActive" in payload and not is_system_admin:
        fields.append("is_active = %s")
        params.append(bool(payload.get("isActive")))
    with db.connect() as conn, conn.cursor() as cur:
        if fields:
            params.append(user_id)
            cur.execute(
                "UPDATE public.app_user SET "
                + ", ".join(fields)
                + ", updated_at = now() WHERE id = %s",
                tuple(params),
            )
        if "roleIds" in payload and not is_system_admin:
            sync_user_roles(cur, user_id, assignable_role_ids(int_list(payload.get("roleIds")), existing["username"]))
    user = get_user(user_id)
    log_audit("user.update", target_type="user", target_id=user_id, detail={"username": user["username"]})
    return user


def set_user_password(user_id: int, password: str) -> None:
    password = clean_required(password, "password")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    db.fetch_all(
        """
        UPDATE public.app_user
        SET password_hash = %s, updated_at = now()
        WHERE id = %s
        RETURNING id
        """,
        (generate_password_hash(password), user_id),
    )
    log_audit("user.password_reset", target_type="user", target_id=user_id)


def change_own_password(current_password: str, new_password: str) -> None:
    user = current_user()
    if not user:
        raise ValueError("Authentication required.")
    rows = db.fetch_all(
        "SELECT password_hash FROM public.app_user WHERE id = %s",
        (user["id"],),
    )
    if not rows or not check_password_hash(rows[0]["password_hash"], current_password or ""):
        log_audit("profile.password_change_failed", actor=user, target_type="user", target_id=user["id"])
        raise ValueError("Current password is incorrect.")
    new_password = clean_required(new_password, "new password")
    if len(new_password) < 8:
        raise ValueError("New password must be at least 8 characters.")
    db.fetch_all(
        """
        UPDATE public.app_user
        SET password_hash = %s, updated_at = now()
        WHERE id = %s
        RETURNING id
        """,
        (generate_password_hash(new_password), user["id"]),
    )
    log_audit("profile.password_change", actor=user, target_type="user", target_id=user["id"])


def get_user(user_id: int) -> dict:
    rows = [u for u in list_users() if u["id"] == user_id]
    if not rows:
        raise ValueError("User not found.")
    return rows[0]


def delete_user(user_id: int) -> None:
    existing = get_user(user_id)
    if is_admin_username(existing["username"]):
        raise ValueError("The system admin user cannot be removed.")
    actor = current_user()
    if actor and actor["id"] == user_id:
        raise ValueError("You cannot remove your own account.")
    db.fetch_all("DELETE FROM public.app_user WHERE id = %s RETURNING id", (user_id,))
    log_audit("user.delete", target_type="user", target_id=user_id, detail={"username": existing["username"]})


def create_role(payload: dict) -> dict:
    name = clean_required(payload.get("name"), "name")
    if name.lower() == ADMIN_ROLE_NAME.lower():
        raise ValueError("The Admin role is reserved.")
    description = clean_text(payload.get("description"), MAX_LONG_TEXT_LEN, "description")
    permissions = permission_list(payload.get("permissions"))
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.app_role (name, description, is_active)
            VALUES (%s, %s, %s)
            RETURNING id
            """,
            (name, description, bool(payload.get("isActive", True))),
        )
        role_id = cur.fetchone()["id"]
        sync_role_permissions(cur, role_id, permissions)
    role = get_role(role_id)
    log_audit("role.create", target_type="role", target_id=role_id, detail={"name": name})
    return role


def update_role(role_id: int, payload: dict) -> dict:
    existing = get_role(role_id)
    if existing["name"].lower() == ADMIN_ROLE_NAME.lower():
        raise ValueError("The Admin role is managed by the system.")
    fields = []
    params = []
    if "name" in payload:
        fields.append("name = %s")
        params.append(clean_required(payload.get("name"), "name"))
    if "description" in payload:
        fields.append("description = %s")
        params.append(clean_text(payload.get("description"), MAX_LONG_TEXT_LEN, "description"))
    if "isActive" in payload:
        fields.append("is_active = %s")
        params.append(bool(payload.get("isActive")))
    with db.connect() as conn, conn.cursor() as cur:
        if fields:
            params.append(role_id)
            cur.execute(
                "UPDATE public.app_role SET "
                + ", ".join(fields)
                + ", updated_at = now() WHERE id = %s",
                tuple(params),
            )
        if "permissions" in payload:
            sync_role_permissions(cur, role_id, permission_list(payload.get("permissions")))
    role = get_role(role_id)
    log_audit("role.update", target_type="role", target_id=role_id, detail={"name": role["name"]})
    return role


def get_role(role_id: int) -> dict:
    rows = [r for r in list_roles() if r["id"] == role_id]
    if not rows:
        raise ValueError("Role not found.")
    return rows[0]


def delete_role(role_id: int) -> None:
    existing = get_role(role_id)
    if existing["name"].lower() == ADMIN_ROLE_NAME.lower():
        raise ValueError("The Admin role is reserved and cannot be removed.")
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) AS n FROM public.quality_workflow_rule WHERE initiator_role_id = %s",
            (role_id,),
        )
        rule_count = int(cur.fetchone()["n"] or 0)
        if rule_count:
            raise ValueError(
                f"Cannot remove role — {rule_count} routing rule(s) reference it. Update those rules first."
            )
        cur.execute("DELETE FROM public.app_role WHERE id = %s", (role_id,))
    log_audit("role.delete", target_type="role", target_id=role_id, detail={"name": existing["name"]})


def create_department(payload: dict) -> dict:
    name = clean_required(payload.get("name"), "name")
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.app_department (name, is_active)
            VALUES (%s, %s)
            RETURNING id
            """,
            (name, bool(payload.get("isActive", True))),
        )
        dept_id = cur.fetchone()["id"]
    department = get_department(dept_id)
    log_audit("department.create", target_type="department", target_id=dept_id, detail={"name": name})
    return department


def update_department(department_id: int, payload: dict) -> dict:
    fields = []
    params = []
    if "name" in payload:
        fields.append("name = %s")
        params.append(clean_required(payload.get("name"), "name"))
    if "isActive" in payload:
        fields.append("is_active = %s")
        params.append(bool(payload.get("isActive")))
    if fields:
        params.append(department_id)
        db.fetch_all(
            "UPDATE public.app_department SET "
            + ", ".join(fields)
            + ", updated_at = now() WHERE id = %s RETURNING id",
            tuple(params),
        )
    department = get_department(department_id)
    log_audit("department.update", target_type="department", target_id=department_id, detail={"name": department["name"]})
    return department


def list_audit_logs(limit: int = 100) -> list[dict]:
    limit = max(1, min(int(limit or 100), 500))
    rows = db.fetch_all(
        """
        SELECT id, actor_username, action, target_type, target_id, detail, ip_address, created_at
        FROM public.app_audit_log
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (limit,),
    )
    for row in rows:
        row["detail"] = row["detail"] or {}
    return rows


def log_audit(
    action: str,
    *,
    actor: dict | None = None,
    actor_username: str | None = None,
    target_type: str | None = None,
    target_id=None,
    detail: dict | None = None,
) -> None:
    try:
        if actor is None:
            actor = current_user()
        username = actor_username or (actor.get("username") if actor else None)
        user_id = actor.get("id") if actor else None
        db.fetch_all(
            """
            INSERT INTO public.app_audit_log
                (actor_user_id, actor_username, action, target_type, target_id, detail, ip_address)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                user_id,
                username,
                action,
                target_type,
                str(target_id) if target_id is not None else None,
                Jsonb(detail or {}),
                client_key(),
            ),
        )
    except Exception:
        return


def get_department(department_id: int) -> dict:
    rows = [d for d in list_departments() if d["id"] == department_id]
    if not rows:
        raise ValueError("Department not found.")
    return rows[0]


def delete_department(department_id: int) -> None:
    existing = get_department(department_id)
    db.fetch_all(
        "DELETE FROM public.app_department WHERE id = %s RETURNING id",
        (department_id,),
    )
    log_audit("department.delete", target_type="department", target_id=department_id, detail={"name": existing["name"]})


def sync_user_roles(cur, user_id: int, role_ids: list[int]) -> None:
    cur.execute("DELETE FROM public.app_user_role WHERE user_id = %s", (user_id,))
    for role_id in role_ids:
        cur.execute(
            "INSERT INTO public.app_user_role (user_id, role_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (user_id, role_id),
        )


def sync_role_permissions(cur, role_id: int, permissions: list[str]) -> None:
    cur.execute("DELETE FROM public.app_role_permission WHERE role_id = %s", (role_id,))
    for permission in permissions:
        cur.execute(
            "INSERT INTO public.app_role_permission (role_id, permission_key) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (role_id, permission),
        )


def clean_text(value, max_len: int = MAX_SHORT_TEXT_LEN, field: str = "value") -> str:
    cleaned = " ".join(str(value or "").split())
    if len(cleaned) > max_len:
        raise ValueError(f"{field} must be {max_len} characters or fewer.")
    return cleaned


def clean_required(value, field: str) -> str:
    cleaned = clean_text(value, MAX_SHORT_TEXT_LEN, field)
    if not cleaned:
        raise ValueError(f"{field} is required.")
    return cleaned


def nullable_int(value):
    if value in {None, "", "null"}:
        return None
    return int(value)


def int_list(values) -> list[int]:
    if not isinstance(values, list):
        return []
    return [int(v) for v in values if v not in {None, "", "null"}]


def permission_list(values) -> list[str]:
    valid = {p[0] for p in DEFAULT_PERMISSIONS} - SYSTEM_ADMIN_PERMISSIONS
    if not isinstance(values, list):
        return []
    return [str(v) for v in values if str(v) in valid]


def is_admin_username(username: str) -> bool:
    expected = os.environ.get("AUTH_USERNAME", "admin").strip() or "admin"
    return str(username or "").lower() == expected.lower()


def assignable_role_ids(role_ids: list[int], username: str) -> list[int]:
    if is_admin_username(username):
        return role_ids
    rows = db.fetch_all(
        """
        SELECT id
        FROM public.app_role
        WHERE name = %s
        """,
        (ADMIN_ROLE_NAME,),
    )
    admin_role_ids = {r["id"] for r in rows}
    return [role_id for role_id in role_ids if role_id not in admin_role_ids]


def safe_next_url(next_url: str | None) -> str:
    if not next_url or not next_url.startswith("/") or next_url.startswith("//"):
        return "/"
    if next_url.startswith("/login") or next_url.startswith("/logout"):
        return "/"
    return next_url


def client_key() -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def current_attempts() -> list[float]:
    now = time.time()
    key = client_key()
    attempts = [ts for ts in _login_attempts.get(key, []) if now - ts < LOGIN_WINDOW_SEC]
    _login_attempts[key] = attempts
    return attempts


def is_rate_limited() -> bool:
    return len(current_attempts()) >= MAX_LOGIN_ATTEMPTS


def record_failed_attempt() -> None:
    attempts = current_attempts()
    attempts.append(time.time())
    _login_attempts[client_key()] = attempts


def clear_attempts() -> None:
    _login_attempts.pop(client_key(), None)
