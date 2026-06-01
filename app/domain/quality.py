from __future__ import annotations

from decimal import Decimal

from flask import jsonify, request

from app.data import db
from app.domain.auth import (
    current_user,
    has_permission,
    log_audit,
    permission_required,
    user_roles,
)


NATURES = {"Credit Note", "Debit Note", "Replacement"}
OPEN_STATUSES = {"open"}
CLOSED_STATUS = "closed"
MAX_SHORT_TEXT_LEN = 200
MAX_LONG_TEXT_LEN = 4000


def register_quality_routes(app) -> None:
    ensure_quality_store()

    def quality_error(exc: Exception, status: int = 400):
        return jsonify({"error": str(exc)}), status

    @app.get("/api/admin/quality/workflows")
    @permission_required("quality.workflow.manage")
    def api_quality_workflows():
        return jsonify({"workflows": list_workflows()})

    @app.post("/api/admin/quality/workflows")
    @permission_required("quality.workflow.manage")
    def api_quality_workflow_create():
        try:
            workflow_id = save_workflow(request.get_json(silent=True) or {})
            return jsonify({"ok": True, "id": workflow_id})
        except ValueError as exc:
            return quality_error(exc)
        except Exception as exc:
            return quality_error(exc, 500)

    @app.patch("/api/admin/quality/workflows/<int:workflow_id>")
    @permission_required("quality.workflow.manage")
    def api_quality_workflow_update(workflow_id: int):
        try:
            save_workflow(request.get_json(silent=True) or {}, workflow_id)
            return jsonify({"ok": True})
        except ValueError as exc:
            return quality_error(exc)
        except Exception as exc:
            return quality_error(exc, 500)

    @app.delete("/api/admin/quality/workflows/<int:workflow_id>")
    @permission_required("quality.workflow.manage")
    def api_quality_workflow_delete(workflow_id: int):
        try:
            orphaned = delete_workflow(workflow_id)
            return jsonify({"ok": True, "orphanedTickets": orphaned})
        except ValueError as exc:
            return quality_error(exc)
        except Exception as exc:
            return quality_error(exc, 500)

    @app.get("/api/admin/quality/rules")
    @permission_required("quality.workflow.manage")
    def api_quality_rules():
        return jsonify({"rules": list_rules()})

    @app.post("/api/admin/quality/rules")
    @permission_required("quality.workflow.manage")
    def api_quality_rule_create():
        try:
            rule_id = save_rule(request.get_json(silent=True) or {})
            return jsonify({"ok": True, "id": rule_id})
        except ValueError as exc:
            return quality_error(exc)
        except Exception as exc:
            return quality_error(exc, 500)

    @app.patch("/api/admin/quality/rules/<int:rule_id>")
    @permission_required("quality.workflow.manage")
    def api_quality_rule_update(rule_id: int):
        try:
            save_rule(request.get_json(silent=True) or {}, rule_id)
            return jsonify({"ok": True})
        except ValueError as exc:
            return quality_error(exc)
        except Exception as exc:
            return quality_error(exc, 500)

    @app.delete("/api/admin/quality/rules/<int:rule_id>")
    @permission_required("quality.workflow.manage")
    def api_quality_rule_delete(rule_id: int):
        try:
            delete_rule(rule_id)
            return jsonify({"ok": True})
        except ValueError as exc:
            return quality_error(exc)
        except Exception as exc:
            return quality_error(exc, 500)

    @app.get("/api/quality/tickets")
    @permission_required("page.quality_tracker")
    def api_quality_tickets():
        my_page = bounded_int(request.args.get("myPage"), 1, 1, 100000)
        my_page_size = bounded_int(request.args.get("myPageSize"), 8, 1, 50)
        my_tickets, my_total = list_my_tickets(my_page, my_page_size)
        return jsonify({
            "tickets": list_tickets(),
            "myTickets": my_tickets,
            "myPagination": {
                "page": my_page,
                "pageSize": my_page_size,
                "total": my_total,
                "totalPages": max(1, (my_total + my_page_size - 1) // my_page_size),
            },
        })

    @app.post("/api/quality/tickets")
    @permission_required("quality.raise")
    def api_quality_ticket_create():
        try:
            ticket_id = create_ticket(request.get_json(silent=True) or {})
            return jsonify({"ok": True, "id": ticket_id})
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

    @app.get("/api/quality/route-preview")
    @permission_required("quality.raise")
    def api_quality_route_preview():
        return jsonify(preview_route(request.args.get("nature"), request.args.get("value")))

    @app.get("/api/quality/tickets/<int:ticket_id>")
    @permission_required("page.quality_tracker")
    def api_quality_ticket_detail(ticket_id: int):
        ticket = get_ticket(ticket_id)
        if not ticket:
            return jsonify({"error": "Ticket not found"}), 404
        return jsonify({"ticket": ticket, "actions": list_ticket_actions(ticket_id)})

    @app.post("/api/quality/tickets/<int:ticket_id>/action")
    @permission_required("page.quality_tracker")
    def api_quality_ticket_action(ticket_id: int):
        try:
            act_on_ticket(ticket_id, request.get_json(silent=True) or {})
            return jsonify({"ok": True})
        except PermissionError as exc:
            return jsonify({"error": str(exc)}), 403
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400


def ensure_quality_store() -> None:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.quality_workflow (
                id bigserial PRIMARY KEY,
                name text NOT NULL UNIQUE,
                description text NOT NULL DEFAULT '',
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.quality_workflow_step (
                id bigserial PRIMARY KEY,
                workflow_id bigint NOT NULL REFERENCES public.quality_workflow(id) ON DELETE CASCADE,
                step_order int NOT NULL,
                name text NOT NULL,
                role_id bigint REFERENCES public.app_role(id) ON DELETE SET NULL,
                department_id bigint REFERENCES public.app_department(id) ON DELETE SET NULL,
                user_id bigint REFERENCES public.app_user(id) ON DELETE SET NULL,
                is_final boolean NOT NULL DEFAULT false,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (workflow_id, step_order)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.quality_workflow_rule (
                id bigserial PRIMARY KEY,
                nature text NOT NULL,
                min_value numeric(18, 2) NOT NULL DEFAULT 0,
                max_value numeric(18, 2),
                workflow_id bigint NOT NULL REFERENCES public.quality_workflow(id) ON DELETE CASCADE,
                initiator_role_id bigint REFERENCES public.app_role(id) ON DELETE CASCADE,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            )
        """)
        cur.execute("""
            ALTER TABLE public.quality_workflow_rule
            ADD COLUMN IF NOT EXISTS initiator_role_id bigint REFERENCES public.app_role(id) ON DELETE CASCADE
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.quality_ticket (
                id bigserial PRIMARY KEY,
                ticket_no text NOT NULL UNIQUE,
                nature text NOT NULL,
                value_amount numeric(18, 2) NOT NULL DEFAULT 0,
                title text NOT NULL,
                description text NOT NULL DEFAULT '',
                status text NOT NULL DEFAULT 'open',
                workflow_id bigint REFERENCES public.quality_workflow(id) ON DELETE SET NULL,
                current_step_id bigint REFERENCES public.quality_workflow_step(id) ON DELETE SET NULL,
                raised_by_user_id bigint REFERENCES public.app_user(id) ON DELETE SET NULL,
                department_id bigint REFERENCES public.app_department(id) ON DELETE SET NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                closed_at timestamptz
            )
        """)
        cur.execute("ALTER TABLE public.quality_ticket ALTER COLUMN workflow_id DROP NOT NULL")
        cur.execute("""
            DO $$
            DECLARE
                cname text;
            BEGIN
                SELECT conname INTO cname
                FROM pg_constraint
                WHERE conrelid = 'public.quality_ticket'::regclass
                  AND contype = 'f'
                  AND conkey = ARRAY[(
                    SELECT attnum FROM pg_attribute
                    WHERE attrelid = 'public.quality_ticket'::regclass AND attname = 'workflow_id'
                  )]
                LIMIT 1;
                IF cname IS NOT NULL THEN
                    EXECUTE format('ALTER TABLE public.quality_ticket DROP CONSTRAINT %I', cname);
                END IF;
                ALTER TABLE public.quality_ticket
                    ADD CONSTRAINT quality_ticket_workflow_id_fkey
                    FOREIGN KEY (workflow_id) REFERENCES public.quality_workflow(id) ON DELETE SET NULL;
            END$$;
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.quality_ticket_action (
                id bigserial PRIMARY KEY,
                ticket_id bigint NOT NULL REFERENCES public.quality_ticket(id) ON DELETE CASCADE,
                step_id bigint REFERENCES public.quality_workflow_step(id) ON DELETE SET NULL,
                actor_user_id bigint REFERENCES public.app_user(id) ON DELETE SET NULL,
                action text NOT NULL,
                comment text NOT NULL DEFAULT '',
                created_at timestamptz NOT NULL DEFAULT now()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS quality_workflow_step_workflow_idx ON public.quality_workflow_step (workflow_id, step_order)")
        cur.execute("CREATE INDEX IF NOT EXISTS quality_workflow_rule_nature_idx ON public.quality_workflow_rule (nature, min_value, max_value)")
        cur.execute("CREATE INDEX IF NOT EXISTS quality_ticket_status_idx ON public.quality_ticket (status)")
        cur.execute("CREATE INDEX IF NOT EXISTS quality_ticket_current_step_idx ON public.quality_ticket (current_step_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS quality_ticket_action_ticket_idx ON public.quality_ticket_action (ticket_id, created_at)")
    normalize_quality_statuses()
    repair_open_ticket_routing()


def normalize_quality_statuses() -> None:
    db.fetch_all(
        """
        UPDATE public.quality_ticket
        SET status = CASE
                WHEN status IN ('closed', 'rejected') THEN 'closed'
                ELSE 'open'
            END,
            closed_at = CASE
                WHEN status IN ('closed', 'rejected') THEN COALESCE(closed_at, updated_at, now())
                ELSE NULL
            END,
            current_step_id = CASE
                WHEN status IN ('closed', 'rejected') THEN NULL
                ELSE current_step_id
            END,
            updated_at = now()
        WHERE status <> 'open' OR (status = 'open' AND closed_at IS NOT NULL)
        RETURNING id
        """
    )


def repair_open_ticket_routing() -> None:
    tickets = db.fetch_all(
        """
        SELECT qt.id, qt.ticket_no, qt.workflow_id, qt.current_step_id,
               u.id AS user_id, u.department_id
        FROM public.quality_ticket qt
        JOIN public.app_user u ON u.id = qt.raised_by_user_id
        WHERE qt.status = 'open'
          AND qt.workflow_id IS NOT NULL
        """
    )
    for ticket in tickets:
        raiser = {"id": ticket["user_id"], "department_id": ticket["department_id"]}
        target_step = None
        initial_step = initial_workflow_step(ticket["workflow_id"], raiser)
        if not ticket.get("current_step_id"):
            target_step = initial_step
        else:
            step = current_step(ticket)
            next_step = next_workflow_step(ticket["workflow_id"], step["step_order"] if step else 0)
            if (
                step
                and initial_step
                and initial_step["step_order"] > step["step_order"]
            ):
                target_step = initial_step
            if (
                step
                and next_step
                and not target_step
                and step_targets_user(step, raiser)
                and not user_has_action_permission(raiser["id"])
            ):
                target_step = next_step
        if target_step and target_step["id"] != ticket.get("current_step_id"):
            with db.connect() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE public.quality_ticket
                    SET current_step_id = %s, updated_at = now()
                    WHERE id = %s
                    """,
                    (target_step["id"], ticket["id"]),
                )
                cur.execute(
                    """
                    INSERT INTO public.quality_ticket_action (ticket_id, step_id, actor_user_id, action, comment)
                    VALUES (%s, %s, NULL, 'routed', %s)
                    """,
                    (ticket["id"], target_step["id"], "Auto-routed to the next approver step."),
                )


def list_workflows() -> list[dict]:
    workflows = db.fetch_all("""
        SELECT id, name, description, is_active, created_at, updated_at
        FROM public.quality_workflow
        ORDER BY is_active DESC, name
    """)
    steps = db.fetch_all("""
        SELECT s.*, r.name AS role_name, d.name AS department_name, u.username, u.display_name
        FROM public.quality_workflow_step s
        LEFT JOIN public.app_role r ON r.id = s.role_id
        LEFT JOIN public.app_department d ON d.id = s.department_id
        LEFT JOIN public.app_user u ON u.id = s.user_id
        ORDER BY s.workflow_id, s.step_order
    """)
    grouped: dict[int, list[dict]] = {}
    for step in steps:
        grouped.setdefault(step["workflow_id"], []).append(step)
    for wf in workflows:
        wf["steps"] = grouped.get(wf["id"], [])
    return workflows


def list_rules() -> list[dict]:
    return db.fetch_all("""
        SELECT qr.*, qw.name AS workflow_name, ar.name AS initiator_role_name
        FROM public.quality_workflow_rule qr
        JOIN public.quality_workflow qw ON qw.id = qr.workflow_id
        LEFT JOIN public.app_role ar ON ar.id = qr.initiator_role_id
        ORDER BY qr.is_active DESC, qr.nature, qr.min_value, qr.max_value NULLS LAST
    """)


def save_workflow(payload: dict, workflow_id: int | None = None) -> int:
    name = clean_required(payload.get("name"), "Workflow name")
    description = clean_text(payload.get("description"), MAX_LONG_TEXT_LEN, "Description")
    is_active = bool(payload.get("isActive", True))
    steps = payload.get("steps") or []
    if not isinstance(steps, list) or not steps:
        raise ValueError("At least one workflow step is required.")

    with db.connect() as conn, conn.cursor() as cur:
        if workflow_id:
            cur.execute(
                """
                UPDATE public.quality_workflow
                SET name = %s, description = %s, is_active = %s, updated_at = now()
                WHERE id = %s
                RETURNING id
                """,
                (name, description, is_active, workflow_id),
            )
            if cur.rowcount == 0:
                raise ValueError("Workflow not found.")
            cur.execute("DELETE FROM public.quality_workflow_step WHERE workflow_id = %s", (workflow_id,))
        else:
            cur.execute(
                """
                INSERT INTO public.quality_workflow (name, description, is_active)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (name, description, is_active),
            )
            workflow_id = cur.fetchone()["id"]

        for index, step in enumerate(steps, start=1):
            step_name = clean_required(step.get("name"), f"Step {index} name")
            cur.execute(
                """
                INSERT INTO public.quality_workflow_step
                    (workflow_id, step_order, name, role_id, department_id, user_id, is_final, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, %s, true)
                """,
                (
                    workflow_id,
                    index,
                    step_name,
                    nullable_int(step.get("roleId")),
                    nullable_int(step.get("departmentId")),
                    nullable_int(step.get("userId")),
                    index == len(steps),
                ),
            )
    log_audit("quality.workflow.save", target_type="quality_workflow", target_id=workflow_id, detail={"name": name})
    return int(workflow_id)


def save_rule(payload: dict, rule_id: int | None = None) -> int:
    nature = clean_required(payload.get("nature"), "Nature")
    if nature not in NATURES:
        raise ValueError("Nature must be Credit Note, Debit Note, or Replacement.")
    min_value = money_value(payload.get("minValue"), "Min value")
    max_value = payload.get("maxValue")
    max_value = None if max_value in {None, ""} else money_value(max_value, "Max value")
    if max_value is not None and max_value <= min_value:
        raise ValueError("Max value must be greater than min value.")
    workflow_id = nullable_int(payload.get("workflowId"))
    if not workflow_id:
        raise ValueError("Workflow is required.")
    initiator_role_id = nullable_int(payload.get("initiatorRoleId"))
    is_active = bool(payload.get("isActive", True))

    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM public.quality_workflow WHERE id = %s", (workflow_id,))
        if not cur.fetchone():
            raise ValueError("Workflow not found.")
        if initiator_role_id is not None:
            cur.execute("SELECT id FROM public.app_role WHERE id = %s", (initiator_role_id,))
            if not cur.fetchone():
                raise ValueError("Initiator role not found.")
        if is_active:
            ensure_no_overlapping_rule(cur, nature, min_value, max_value, initiator_role_id, rule_id)
        if rule_id:
            cur.execute(
                """
                UPDATE public.quality_workflow_rule
                SET nature = %s, min_value = %s, max_value = %s, workflow_id = %s,
                    initiator_role_id = %s, is_active = %s, updated_at = now()
                WHERE id = %s
                RETURNING id
                """,
                (nature, min_value, max_value, workflow_id, initiator_role_id, is_active, rule_id),
            )
            if cur.rowcount == 0:
                raise ValueError("Rule not found.")
        else:
            cur.execute(
                """
                INSERT INTO public.quality_workflow_rule
                    (nature, min_value, max_value, workflow_id, initiator_role_id, is_active)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (nature, min_value, max_value, workflow_id, initiator_role_id, is_active),
            )
            rule_id = cur.fetchone()["id"]
    log_audit("quality.rule.save", target_type="quality_rule", target_id=rule_id, detail={"nature": nature})
    return int(rule_id)


def ensure_no_overlapping_rule(cur, nature: str, min_value: Decimal, max_value: Decimal | None, initiator_role_id, rule_id: int | None) -> None:
    cur.execute(
        """
        SELECT qr.id, qr.min_value, qr.max_value, qw.name AS workflow_name, ar.name AS initiator_role_name
        FROM public.quality_workflow_rule qr
        JOIN public.quality_workflow qw ON qw.id = qr.workflow_id
        LEFT JOIN public.app_role ar ON ar.id = qr.initiator_role_id
        WHERE qr.is_active = true
          AND qr.nature = %s
          AND qr.initiator_role_id IS NOT DISTINCT FROM %s
          AND (CAST(%s AS bigint) IS NULL OR qr.id <> CAST(%s AS bigint))
          AND qr.min_value < COALESCE(CAST(%s AS numeric), '999999999999999999'::numeric)
          AND COALESCE(qr.max_value, '999999999999999999'::numeric) > %s
        LIMIT 1
        """,
        (nature, initiator_role_id, rule_id, rule_id, max_value, min_value),
    )
    existing = cur.fetchone()
    if existing:
        role_name = existing["initiator_role_name"] or "Any role"
        raise ValueError(
            f"An active {nature} rule already overlaps for initiator {role_name} "
            f"and routes to {existing['workflow_name']}."
        )


def delete_workflow(workflow_id: int) -> int:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT name FROM public.quality_workflow WHERE id = %s", (workflow_id,))
        row = cur.fetchone()
        if not row:
            raise ValueError("Workflow not found.")
        cur.execute(
            "SELECT count(*) AS n FROM public.quality_ticket WHERE workflow_id = %s",
            (workflow_id,),
        )
        ticket_count = int(cur.fetchone()["n"] or 0)
        cur.execute(
            """
            UPDATE public.quality_ticket
            SET status = 'closed', current_step_id = NULL, closed_at = now(), updated_at = now()
            WHERE workflow_id = %s AND status = 'open'
            """,
            (workflow_id,),
        )
        cur.execute("DELETE FROM public.quality_workflow WHERE id = %s", (workflow_id,))
    log_audit(
        "quality.workflow.delete",
        target_type="quality_workflow",
        target_id=workflow_id,
        detail={"name": row["name"], "orphaned_tickets": ticket_count},
    )
    return ticket_count


def delete_rule(rule_id: int) -> None:
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT nature FROM public.quality_workflow_rule WHERE id = %s", (rule_id,))
        row = cur.fetchone()
        if not row:
            raise ValueError("Rule not found.")
        cur.execute("DELETE FROM public.quality_workflow_rule WHERE id = %s", (rule_id,))
    log_audit("quality.rule.delete", target_type="quality_rule", target_id=rule_id, detail={"nature": row["nature"]})


def list_tickets() -> list[dict]:
    rows = visible_ticket_rows(limit=500)
    for row in rows:
        decorate_ticket(row)
    return rows


def list_my_tickets(page: int, page_size: int) -> tuple[list[dict], int]:
    user = current_user()
    if not user:
        return [], 0
    total_rows = db.fetch_all(
        "SELECT count(*) AS total FROM public.quality_ticket WHERE raised_by_user_id = %s",
        (user["id"],),
    )
    total = int(total_rows[0]["total"] or 0) if total_rows else 0
    offset = (page - 1) * page_size
    rows = ticket_rows(
        "WHERE qt.raised_by_user_id = %s",
        (user["id"], page_size, offset),
        limit_sql="LIMIT %s OFFSET %s",
    )
    for row in rows:
        decorate_ticket(row)
    return rows, total


def visible_ticket_rows(ticket_id: int | None = None, limit: int | None = None) -> list[dict]:
    user = current_user()
    if not user:
        return []

    where = ""
    params: list = []
    if ticket_id is not None:
        where = "WHERE qt.id = %s"
        params.append(ticket_id)
    visibility = visible_ticket_sql(user)
    where = f"{where} AND {visibility}" if where else f"WHERE {visibility}"
    params.extend(visible_ticket_params(user))
    limit_sql = "LIMIT %s" if limit else ""
    if limit:
        params.append(limit)

    return ticket_rows(where, tuple(params), limit_sql=limit_sql)


def ticket_rows(where: str = "", params: tuple = (), limit: int | None = None, limit_sql: str | None = None) -> list[dict]:
    query_limit = limit_sql if limit_sql is not None else ("LIMIT %s" if limit else "")
    query_params = list(params)
    if limit and limit_sql is None:
        query_params.append(limit)
    return db.fetch_all(f"""
        SELECT qt.*, qw.name AS workflow_name, qws.name AS current_step_name,
               u.username AS raised_by_username, u.display_name AS raised_by_display,
               d.name AS department_name
        FROM public.quality_ticket qt
        LEFT JOIN public.quality_workflow qw ON qw.id = qt.workflow_id
        LEFT JOIN public.quality_workflow_step qws ON qws.id = qt.current_step_id
        LEFT JOIN public.app_user u ON u.id = qt.raised_by_user_id
        LEFT JOIN public.app_department d ON d.id = qt.department_id
        {where}
        ORDER BY qt.created_at DESC
        {query_limit}
    """, tuple(query_params))


def visible_ticket_sql(user: dict) -> str:
    role_ids = [role["id"] for role in user_roles(user["id"])]
    role_clause = (
        f"qws.role_id IS NULL OR qws.role_id IN ({', '.join(['%s'] * len(role_ids))})"
        if role_ids else
        "qws.role_id IS NULL"
    )
    workflow_role_clause = (
        f"step_any.role_id IS NULL OR step_any.role_id IN ({', '.join(['%s'] * len(role_ids))})"
        if role_ids else
        "step_any.role_id IS NULL"
    )
    return f"""
        (
            qt.raised_by_user_id = %s
            OR (
                qt.status = 'open'
                AND qt.current_step_id IS NOT NULL
                AND (qws.user_id IS NULL OR qws.user_id = %s)
                AND (qws.department_id IS NULL OR qws.department_id = %s)
                AND ({role_clause})
            )
            OR EXISTS (
                SELECT 1
                FROM public.quality_ticket_action qta_seen
                WHERE qta_seen.ticket_id = qt.id
                  AND qta_seen.actor_user_id = %s
            )
            OR EXISTS (
                SELECT 1
                FROM public.quality_workflow_step step_any
                WHERE step_any.workflow_id = qt.workflow_id
                  AND (
                    step_any.user_id = %s
                    OR (
                        step_any.user_id IS NULL
                        AND (step_any.department_id IS NULL OR step_any.department_id = %s)
                        AND ({workflow_role_clause})
                    )
                  )
            )
        )
    """


def visible_ticket_params(user: dict) -> list:
    role_ids = [role["id"] for role in user_roles(user["id"])]
    params = [
        user["id"],
        user["id"],
        user.get("department_id"),
    ]
    if role_ids:
        params.extend(role_ids)
    params.extend([user["id"], user["id"], user.get("department_id")])
    if role_ids:
        params.extend(role_ids)
    return params


def decorate_ticket(row: dict) -> dict:
    user = current_user()
    is_open = row.get("status") in OPEN_STATUSES
    row["can_act"] = is_open and can_act_on_ticket(row, user)
    row["is_mine"] = bool(user and row["raised_by_user_id"] == user["id"])
    return row


def create_ticket(payload: dict) -> int:
    user = current_user()
    if not user:
        raise ValueError("Authentication required.")
    nature = clean_required(payload.get("nature"), "Nature")
    if nature not in NATURES:
        raise ValueError("Nature must be Credit Note, Debit Note, or Replacement.")
    value = money_value(payload.get("valueAmount"), "Value")
    title = clean_required(payload.get("title"), "Title")
    description = clean_text(payload.get("description"), MAX_LONG_TEXT_LEN, "Description")
    department_id = nullable_int(payload.get("departmentId")) or user.get("department_id")
    role_ids = [role["id"] for role in user_roles(user["id"])]
    workflow = matching_workflow(nature, value, role_ids)
    if not workflow:
        raise ValueError("No active workflow rule matches this nature, value, and your role.")
    first_step = initial_workflow_step(workflow["id"], user)
    if not first_step:
        raise ValueError("Matched workflow has no active approver steps.")

    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT nextval('public.quality_ticket_id_seq') AS id")
        ticket_id = cur.fetchone()["id"]
        ticket_no = f"QT-{ticket_id:05d}"
        cur.execute(
            """
            INSERT INTO public.quality_ticket
                (id, ticket_no, nature, value_amount, title, description, status,
                 workflow_id, current_step_id, raised_by_user_id, department_id)
            VALUES (%s, %s, %s, %s, %s, %s, 'open', %s, %s, %s, %s)
            """,
            (ticket_id, ticket_no, nature, value, title, description, workflow["id"], first_step["id"], user["id"], department_id),
        )
        cur.execute(
            """
            INSERT INTO public.quality_ticket_action (ticket_id, step_id, actor_user_id, action, comment)
            VALUES (%s, %s, %s, 'raised', %s)
            """,
            (
                ticket_id,
                first_step["id"],
                user["id"],
                f"{description} Routed by rule #{workflow.get('rule_id')} to workflow {workflow.get('name')}.",
            ),
        )
    log_audit("quality.ticket.raise", target_type="quality_ticket", target_id=ticket_id, detail={"ticket_no": ticket_no})
    return int(ticket_id)


def preview_route(nature_raw, value_raw) -> dict:
    user = current_user()
    if not user:
        return {"matched": False, "reason": "auth", "message": "Sign in to raise a query."}
    nature = clean_text(nature_raw, MAX_SHORT_TEXT_LEN, "Nature")
    if nature not in NATURES:
        return {"matched": False, "reason": "nature", "message": "Pick a nature first."}
    if value_raw in (None, ""):
        return {"matched": False, "reason": "value", "message": "Enter a value to see where this routes."}
    try:
        value = money_value(value_raw, "Value")
    except ValueError as exc:
        return {"matched": False, "reason": "value", "message": str(exc)}
    role_ids = [role["id"] for role in user_roles(user["id"])]
    workflow = matching_workflow(nature, value, role_ids)
    if not workflow:
        return {
            "matched": False,
            "reason": "no_rule",
            "message": "No workflow rule covers this nature, value, and your role.",
        }
    first_step = initial_workflow_step(workflow["id"], user)
    if not first_step:
        return {
            "matched": False,
            "reason": "no_steps",
            "message": f"“{workflow.get('name')}” has no active approver steps.",
        }
    return {
        "matched": True,
        "message": "This query would be routed to an active workflow.",
    }


def get_ticket(ticket_id: int) -> dict | None:
    rows = visible_ticket_rows(ticket_id=ticket_id)
    return decorate_ticket(rows[0]) if rows else None


def list_ticket_actions(ticket_id: int) -> list[dict]:
    return db.fetch_all("""
        SELECT qta.*, u.username, u.display_name, qws.name AS step_name
        FROM public.quality_ticket_action qta
        LEFT JOIN public.app_user u ON u.id = qta.actor_user_id
        LEFT JOIN public.quality_workflow_step qws ON qws.id = qta.step_id
        WHERE qta.ticket_id = %s
        ORDER BY qta.created_at
    """, (ticket_id,))


def act_on_ticket(ticket_id: int, payload: dict) -> None:
    user = current_user()
    ticket = get_ticket(ticket_id)
    if not user or not ticket:
        raise ValueError("Ticket not found.")
    action = clean_required(payload.get("action"), "Action")
    comment = clean_text(payload.get("comment"), MAX_LONG_TEXT_LEN, "Comment")
    if action not in {"approve", "reject", "request_changes", "close", "resubmit"}:
        raise ValueError("Unsupported action.")

    if action == "resubmit":
        if ticket["raised_by_user_id"] != user["id"] and not has_permission("quality.workflow.manage"):
            raise PermissionError("Only the raiser can resubmit this ticket.")
        if ticket["status"] != "open":
            raise ValueError("Only open tickets can be resubmitted.")
        first_step = initial_workflow_step(ticket["workflow_id"], user)
        if not first_step:
            raise ValueError("Workflow has no active approver steps.")
        _update_ticket(ticket_id, "open", first_step["id"], None)
    else:
        if ticket["status"] not in OPEN_STATUSES:
            raise ValueError("This ticket has already been closed.")
        if not can_act_on_ticket(ticket, user):
            raise PermissionError("This ticket is not assigned to you at the current step.")
        if action in {"approve", "reject", "request_changes"} and not has_permission("quality.approve"):
            raise PermissionError("You do not have approval access.")
        if action == "close" and not has_permission("quality.close"):
            raise PermissionError("You do not have close access.")
        if action == "approve":
            step = current_step(ticket)
            next_step = next_workflow_step(ticket["workflow_id"], step["step_order"] if step else 0)
            if next_step:
                _update_ticket(ticket_id, "open", next_step["id"], None)
            else:
                _update_ticket(ticket_id, "closed", None, "now")
        elif action == "reject":
            _update_ticket(ticket_id, "closed", None, "now")
        elif action == "request_changes":
            _update_ticket(ticket_id, "open", ticket["current_step_id"], None)
        elif action == "close":
            _update_ticket(ticket_id, "closed", None, "now")

    with db.connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.quality_ticket_action (ticket_id, step_id, actor_user_id, action, comment)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (ticket_id, ticket.get("current_step_id"), user["id"], action, comment),
        )
    log_audit("quality.ticket.action", target_type="quality_ticket", target_id=ticket_id, detail={"action": action})


def _update_ticket(ticket_id: int, status: str, current_step_id, closed: str | None) -> None:
    closed_sql = "now()" if closed else "NULL"
    db.fetch_all(
        f"""
        UPDATE public.quality_ticket
        SET status = %s, current_step_id = %s, updated_at = now(), closed_at = {closed_sql}
        WHERE id = %s
        RETURNING id
        """,
        (status, current_step_id, ticket_id),
    )


def can_act_on_ticket(ticket: dict, user: dict | None) -> bool:
    if not user or ticket.get("status") not in OPEN_STATUSES or not ticket.get("current_step_id"):
        return False
    step = current_step(ticket)
    if not step:
        return False
    if step.get("user_id") and step["user_id"] != user["id"]:
        return False
    if step.get("department_id") and step["department_id"] != user.get("department_id"):
        return False
    if step.get("role_id"):
        role_ids = {role["id"] for role in user_roles(user["id"])}
        if step["role_id"] not in role_ids:
            return False
    return True


def step_targets_user(step: dict, user: dict) -> bool:
    if step.get("user_id"):
        return step["user_id"] == user["id"]
    if step.get("department_id") and step["department_id"] != user.get("department_id"):
        return False
    if step.get("role_id"):
        role_ids = {role["id"] for role in user_roles(user["id"])}
        return step["role_id"] in role_ids
    return True


def user_has_action_permission(user_id: int) -> bool:
    rows = db.fetch_all(
        """
        SELECT 1
        FROM public.app_user_role ur
        JOIN public.app_role r ON r.id = ur.role_id AND r.is_active = true
        JOIN public.app_role_permission rp ON rp.role_id = r.id
        WHERE ur.user_id = %s
          AND rp.permission_key IN ('quality.approve', 'quality.close', 'quality.workflow.manage')
        LIMIT 1
        """,
        (user_id,),
    )
    return bool(rows)


def current_step(ticket: dict) -> dict | None:
    if not ticket.get("current_step_id"):
        return None
    rows = db.fetch_all("SELECT * FROM public.quality_workflow_step WHERE id = %s", (ticket["current_step_id"],))
    return rows[0] if rows else None


def first_workflow_step(workflow_id: int) -> dict | None:
    rows = db.fetch_all(
        """
        SELECT * FROM public.quality_workflow_step
        WHERE workflow_id = %s AND is_active = true
        ORDER BY step_order
        LIMIT 1
        """,
        (workflow_id,),
    )
    return rows[0] if rows else None


def workflow_steps(workflow_id: int) -> list[dict]:
    return db.fetch_all(
        """
        SELECT *
        FROM public.quality_workflow_step
        WHERE workflow_id = %s AND is_active = true
        ORDER BY step_order
        """,
        (workflow_id,),
    )


def initial_workflow_step(workflow_id: int, raiser: dict) -> dict | None:
    steps = workflow_steps(workflow_id)
    if not steps:
        return None
    for step in steps:
        if step_targets_user(step, raiser):
            continue
        return step
    return steps[0]


def next_workflow_step(workflow_id: int, step_order: int) -> dict | None:
    rows = db.fetch_all(
        """
        SELECT * FROM public.quality_workflow_step
        WHERE workflow_id = %s AND is_active = true AND step_order > %s
        ORDER BY step_order
        LIMIT 1
        """,
        (workflow_id, step_order),
    )
    return rows[0] if rows else None


def matching_workflow(nature: str, value: Decimal, role_ids: list[int] | None = None) -> dict | None:
    role_ids = role_ids or []
    if role_ids:
        role_placeholders = ", ".join(["%s"] * len(role_ids))
        role_clause = f"(qr.initiator_role_id IS NULL OR qr.initiator_role_id IN ({role_placeholders}))"
        role_params = role_ids
    else:
        role_clause = "qr.initiator_role_id IS NULL"
        role_params = []
    rows = db.fetch_all(
        f"""
        SELECT qw.*, qr.id AS rule_id
        FROM public.quality_workflow_rule qr
        JOIN public.quality_workflow qw ON qw.id = qr.workflow_id AND qw.is_active = true
        WHERE qr.is_active = true
          AND qr.nature = %s
          AND qr.min_value <= %s
          AND (qr.max_value IS NULL OR qr.max_value > %s)
          AND {role_clause}
        ORDER BY (qr.initiator_role_id IS NOT NULL) DESC,
                 qr.min_value DESC, qr.max_value ASC NULLS LAST
        LIMIT 1
        """,
        (nature, value, value, *role_params),
    )
    return rows[0] if rows else None


def clean_text(value, max_len: int = MAX_SHORT_TEXT_LEN, field: str = "Value") -> str:
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


def money_value(value, field: str) -> Decimal:
    try:
        amount = Decimal(str(value or "0"))
    except Exception as exc:
        raise ValueError(f"{field} must be a number.") from exc
    if amount < 0:
        raise ValueError(f"{field} cannot be negative.")
    return amount


def bounded_int(value, default: int, min_value: int, max_value: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(min_value, min(max_value, parsed))
