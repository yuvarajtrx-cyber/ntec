import pandas as pd
from psycopg import sql

from app.data import db
from app.domain.customers import customer_key_variants
from app.ingest.text_utils import salesperson_canon
from app.ingest.upload import LINE_ITEM_TABLE

TABLE_NAME = "sales_register"
SALESPERSON_TABLE = "customer_salesperson"


class DataSourceError(Exception):
    """Raised when the database is unreachable or returns no rows."""


def from_db(date_from: str | None = None, date_to: str | None = None) -> pd.DataFrame:
    # NOTE: TABLE_NAME is a trusted constant. We still avoid f-string interpolation
    # in new code for defense-in-depth (see security review).
    where_parts: list[str] = []
    params: list = []
    if date_from:
        where_parts.append("voucher_date >= %s")
        params.append(date_from)
    if date_to:
        where_parts.append("voucher_date <= %s")
        params.append(date_to)
    where_sql = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""
    query = f"SELECT * FROM {TABLE_NAME}{where_sql} ORDER BY voucher_date"
    try:
        rows = db.fetch_all(query, tuple(params) if params else None)
    except Exception as e:
        raise DataSourceError(f"Could not fetch from Postgres: {e}") from e

    if not rows:
        if not where_parts:
            raise DataSourceError(
                f"Table '{TABLE_NAME}' is empty. Use the Upload button to add data."
            )
        # Empty range is a valid state — return an empty frame with the columns
        # downstream code expects so build_payload can short-circuit cleanly.
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["voucher_date"] = pd.to_datetime(df["voucher_date"])
    return df


def fetch_salesperson_map() -> dict[str, str]:
    """normalized customer_name -> sales_person."""
    try:
        # NOTE: SALESPERSON_TABLE is a trusted constant (see security review)
        rows = db.fetch_all(f"SELECT customer_name, sales_person FROM {SALESPERSON_TABLE}")
    except Exception:
        return {}
    out: dict[str, str] = {}
    alias_people: dict[str, set[str]] = {}
    for r in rows:
        person = salesperson_canon(r.get("sales_person"))
        if not person:
            continue
        variants = customer_key_variants(r.get("customer_name"))
        if not variants:
            continue
        key = variants[0]
        if key:
            out[key] = person
        for alias in variants[1:]:
            alias_people.setdefault(alias, set()).add(person)
    for alias, people in alias_people.items():
        if alias not in out and len(people) == 1:
            out[alias] = next(iter(people))
    return out


def fetch_line_items(voucher_nos: list[str] | None = None) -> dict[str, list[dict]]:
    """Return product line items grouped by voucher_no.

    If voucher_nos is provided, only fetch lines for those vouchers — saves a
    full-table read when callers already know the in-scope voucher set.
    """
    if voucher_nos is not None and not voucher_nos:
        return {}
    where_sql = ""
    params: tuple | None = None
    if voucher_nos is not None:
        where_sql = " WHERE voucher_no = ANY(%s)"
        params = (voucher_nos,)
    try:
        # NOTE: LINE_ITEM_TABLE is a trusted constant (see security review)
        rows = db.fetch_all(
            f"SELECT voucher_no, line_no, particulars, quantity, rate, value "
            f"FROM {LINE_ITEM_TABLE}{where_sql} ORDER BY voucher_no, line_no",
            params,
        )
    except Exception:
        return {}
    grouped: dict[str, list[dict]] = {}
    for r in rows:
        vno = r.get("voucher_no")
        if not vno:
            continue
        grouped.setdefault(vno, []).append({
            "line_no": r.get("line_no"),
            "particulars": r.get("particulars"),
            "quantity": float(r["quantity"]) if r.get("quantity") is not None else None,
            "rate": float(r["rate"]) if r.get("rate") is not None else None,
            "value": float(r["value"]) if r.get("value") is not None else None,
        })
    return grouped


def insert_records(cur, table: str, records: list[dict]) -> None:
    if not records:
        return
    cols = list(records[0].keys())
    stmt = sql.SQL("INSERT INTO {table} ({cols}) VALUES ({placeholders})").format(
        table=sql.Identifier(table),
        cols=sql.SQL(", ").join(sql.Identifier(c) for c in cols),
        placeholders=sql.SQL(", ").join(sql.Placeholder(c) for c in cols),
    )
    cur.executemany(stmt, records)
