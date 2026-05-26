import pandas as pd
from psycopg import sql

import db
from customers import customer_key_variants
from text_utils import salesperson_canon
from upload import LINE_ITEM_TABLE

TABLE_NAME = "sales_register"
SALESPERSON_TABLE = "customer_salesperson"


class DataSourceError(Exception):
    """Raised when the database is unreachable or returns no rows."""


def from_db() -> pd.DataFrame:
    try:
        rows = db.fetch_all(f"SELECT * FROM {TABLE_NAME} ORDER BY voucher_date")
    except Exception as e:
        raise DataSourceError(f"Could not fetch from Postgres: {e}") from e

    if not rows:
        raise DataSourceError(
            f"Table '{TABLE_NAME}' is empty. Use the Upload button to add data."
        )

    df = pd.DataFrame(rows)
    df["voucher_date"] = pd.to_datetime(df["voucher_date"])
    return df


def fetch_salesperson_map() -> dict[str, str]:
    """normalized customer_name -> sales_person."""
    try:
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


def fetch_line_items() -> dict[str, list[dict]]:
    """Return product line items grouped by voucher_no."""
    try:
        rows = db.fetch_all(
            f"SELECT voucher_no, line_no, particulars, quantity, rate, value "
            f"FROM {LINE_ITEM_TABLE} ORDER BY voucher_no, line_no"
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
