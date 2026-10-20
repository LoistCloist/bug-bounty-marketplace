"""Postgres connections. The schema is owned by the API's migrations."""

from __future__ import annotations

import psycopg
from psycopg.rows import dict_row


def connect(database_url: str) -> psycopg.Connection:
    """A dict-row connection with autocommit off: callers commit explicitly."""
    return psycopg.connect(database_url, row_factory=dict_row, autocommit=False)
