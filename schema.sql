-- Run against the local Postgres database:
--     psql "$DATABASE_URL" -f schema.sql
-- Creates a flat table mirroring the Excel sheet.

create table if not exists public.sales_register (
    id                  bigserial primary key,
    voucher_date        date,
    particulars         text,
    voucher_type        text,
    voucher_no          text,
    voucher_ref_no      text,
    gstin_uin           text,
    quantity            numeric(18, 4),
    rate                numeric(18, 4),
    taxable_value       numeric(18, 4),
    gross_total         numeric(18, 4),
    gst_sales_dom_fg    numeric(18, 4),
    sgst_9pct           numeric(18, 4),
    cgst_9pct           numeric(18, 4),
    round_off           numeric(18, 4),
    discount            numeric(18, 4),
    gst_sales_freight   numeric(18, 4),
    igst_18pct          numeric(18, 4),
    gst_sales_dom_rm    numeric(18, 4),
    scrap_sales         numeric(18, 4),
    tcs_scrap_206ce     numeric(18, 4),
    gst_exports_rm      numeric(18, 4),
    gst_exports_fg      numeric(18, 4),
    inserted_at         timestamptz default now()
);

create index if not exists sales_register_date_idx     on public.sales_register (voucher_date);
create index if not exists sales_register_vtype_idx    on public.sales_register (voucher_type);
create index if not exists sales_register_gstin_idx    on public.sales_register (gstin_uin);
create index if not exists sales_register_vno_idx      on public.sales_register (voucher_no);

-- One row per product line inside a voucher. voucher_no is the logical link
-- back to sales_register; not enforced as a FK so duplicate uploads still work.
create table if not exists public.sales_line_item (
    id            bigserial primary key,
    voucher_no    text not null,
    line_no       int,
    particulars   text,
    quantity      numeric(18, 4),
    rate          numeric(18, 4),
    value         numeric(18, 4),
    inserted_at   timestamptz default now()
);

create index if not exists sales_line_item_vno_idx on public.sales_line_item (voucher_no);

-- Maps a customer (matched against sales_register.particulars, case-insensitive)
-- to a salesperson. Uploaded as a separate Excel; full-replace each upload.
create table if not exists public.customer_salesperson (
    customer_name text primary key,
    sales_person  text not null,
    updated_at    timestamptz default now()
);

create index if not exists customer_salesperson_person_idx
    on public.customer_salesperson (sales_person);

-- Application users, roles, departments, and permissions.
create table if not exists public.app_department (
    id          bigserial primary key,
    name        text not null unique,
    is_active   boolean not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists public.app_role (
    id          bigserial primary key,
    name        text not null unique,
    description text not null default '',
    is_active   boolean not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists public.app_permission (
    key         text primary key,
    label       text not null,
    category    text not null,
    created_at  timestamptz not null default now()
);

create table if not exists public.app_user (
    id               bigserial primary key,
    username         text not null unique,
    password_hash    text not null,
    display_name     text not null default '',
    department_id    bigint references public.app_department(id) on delete set null,
    is_active        boolean not null default true,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create table if not exists public.app_role_permission (
    role_id         bigint not null references public.app_role(id) on delete cascade,
    permission_key  text not null references public.app_permission(key) on delete cascade,
    primary key (role_id, permission_key)
);

create table if not exists public.app_user_role (
    user_id  bigint not null references public.app_user(id) on delete cascade,
    role_id  bigint not null references public.app_role(id) on delete cascade,
    primary key (user_id, role_id)
);

create index if not exists app_user_department_idx on public.app_user (department_id);
create index if not exists app_role_permission_perm_idx on public.app_role_permission (permission_key);

create table if not exists public.app_audit_log (
    id             bigserial primary key,
    actor_user_id  bigint references public.app_user(id) on delete set null,
    actor_username text,
    action         text not null,
    target_type    text,
    target_id      text,
    detail         jsonb not null default '{}'::jsonb,
    ip_address     text,
    created_at     timestamptz not null default now()
);

create index if not exists app_audit_log_created_idx on public.app_audit_log (created_at desc);
create index if not exists app_audit_log_action_idx on public.app_audit_log (action);

create table if not exists public.quality_workflow (
    id          bigserial primary key,
    name        text not null unique,
    description text not null default '',
    is_active   boolean not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists public.quality_workflow_step (
    id             bigserial primary key,
    workflow_id    bigint not null references public.quality_workflow(id) on delete cascade,
    step_order     int not null,
    name           text not null,
    role_id        bigint references public.app_role(id) on delete set null,
    department_id  bigint references public.app_department(id) on delete set null,
    user_id        bigint references public.app_user(id) on delete set null,
    is_final       boolean not null default false,
    is_active      boolean not null default true,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    unique (workflow_id, step_order)
);

create table if not exists public.quality_workflow_rule (
    id                  bigserial primary key,
    nature              text not null,
    min_value           numeric(18, 2) not null default 0,
    max_value           numeric(18, 2),
    workflow_id         bigint not null references public.quality_workflow(id) on delete cascade,
    initiator_role_id   bigint references public.app_role(id) on delete cascade,
    is_active           boolean not null default true,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create table if not exists public.quality_ticket (
    id                  bigserial primary key,
    ticket_no           text not null unique,
    nature              text not null,
    value_amount        numeric(18, 2) not null default 0,
    title               text not null,
    description         text not null default '',
    status              text not null default 'open',
    workflow_id         bigint references public.quality_workflow(id) on delete set null,
    current_step_id     bigint references public.quality_workflow_step(id) on delete set null,
    raised_by_user_id   bigint references public.app_user(id) on delete set null,
    department_id       bigint references public.app_department(id) on delete set null,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    closed_at           timestamptz
);

create table if not exists public.quality_ticket_action (
    id             bigserial primary key,
    ticket_id      bigint not null references public.quality_ticket(id) on delete cascade,
    step_id        bigint references public.quality_workflow_step(id) on delete set null,
    actor_user_id  bigint references public.app_user(id) on delete set null,
    action         text not null,
    comment        text not null default '',
    created_at     timestamptz not null default now()
);

create index if not exists quality_workflow_step_workflow_idx on public.quality_workflow_step (workflow_id, step_order);
create index if not exists quality_workflow_rule_nature_idx on public.quality_workflow_rule (nature, min_value, max_value);
create index if not exists quality_ticket_status_idx on public.quality_ticket (status);
create index if not exists quality_ticket_current_step_idx on public.quality_ticket (current_step_id);
create index if not exists quality_ticket_action_ticket_idx on public.quality_ticket_action (ticket_id, created_at);
