import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row


def dsn() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Add it to .env, e.g. "
            "DATABASE_URL=postgresql:///yuvaraj"
        )
    return url


@contextmanager
def connect():
    with psycopg.connect(dsn(), row_factory=dict_row) as conn:
        yield conn


def fetch_all(sql: str, params: tuple | None = None) -> list[dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())
