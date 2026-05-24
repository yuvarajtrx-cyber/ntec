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
