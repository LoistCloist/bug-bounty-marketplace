"""Shared fixtures. Database tests need DATABASE_URL (they apply the API's
migrations and clean up after themselves); without it they are skipped."""

from __future__ import annotations

import hashlib
import os
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

# Tests must not pick up a developer's workers/analysis/.env.
os.environ["ANALYSIS_LOAD_DOTENV"] = "0"

MIGRATIONS = Path(__file__).resolve().parents[3] / "apps" / "api" / "src" / "db" / "migrations"
TABLES = "jobs, poc_submissions, findings, contracts, bounties"


@pytest.fixture(scope="session")
def test_database_url() -> str:
    """A dedicated `<db>_worker_test` database on DATABASE_URL's server, so the
    TRUNCATEs below never touch the dev database (or a running demo)."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not set")
    info = conninfo_to_dict(url)
    name = f"{info.get('dbname', 'postgres')}_worker_test"
    with psycopg.connect(url, autocommit=True) as admin:
        exists = admin.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone()
        if not exists:
            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    return make_conninfo(url, dbname=name)


@pytest.fixture
def pg_conn(test_database_url: str) -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(test_database_url, row_factory=dict_row)
    for migration in sorted(MIGRATIONS.glob("*.sql")):
        conn.execute(migration.read_text())
    conn.execute(f"TRUNCATE {TABLES}")
    conn.commit()
    try:
        yield conn
    finally:
        conn.rollback()
        conn.execute(f"TRUNCATE {TABLES}")
        conn.commit()
        conn.close()


def insert_contract(
    conn: psycopg.Connection,
    source: bytes,
    storage_dir: Path,
    filename: str = "Vault.sol",
    *,
    queue_job: bool = True,
) -> str:
    """Stores `source` like the API does and inserts the contract and bounty
    rows (plus a queued analysis job unless `queue_job` is False)."""
    contract_id = f"contract_{uuid.uuid4()}"
    bounty_id = f"bounty_{uuid.uuid4()}"
    sha = hashlib.sha256(source).hexdigest()
    key = f"contracts/{contract_id}/{sha}.sol"
    (storage_dir / key).parent.mkdir(parents=True, exist_ok=True)
    (storage_dir / key).write_bytes(source)
    now = datetime.now(UTC)
    conn.execute(
        "INSERT INTO bounties (id, contract_id, amount, currency, funded_at, deadline)"
        " VALUES (%s, %s, 1, 'ETH', %s, '2030-01-01T00:00:00Z')",
        (bounty_id, contract_id, now),
    )
    conn.execute(
        "INSERT INTO contracts (id, developer_address, filename, source_hash, source_reference,"
        " bounty_id, status, created_at, deadline)"
        " VALUES (%s, %s, %s, %s, %s, %s, 'Open', %s, '2030-01-01T00:00:00Z')",
        (contract_id, "0x" + "1" * 40, filename, sha, key, bounty_id, now),
    )
    if queue_job:
        insert_job(conn, "analysis", contract_id)
    conn.commit()
    return contract_id


def insert_job(conn: psycopg.Connection, kind: str, subject_id: str, **columns) -> str:
    job_id = f"job_{uuid.uuid4()}"
    values = {
        "id": job_id,
        "kind": kind,
        "subject_id": subject_id,
        "status": "queued",
        "attempts": 0,
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
        **columns,
    }
    names = ", ".join(values)
    placeholders = ", ".join(["%s"] * len(values))
    conn.execute(f"INSERT INTO jobs ({names}) VALUES ({placeholders})", list(values.values()))
    conn.commit()
    return job_id


def insert_finding(conn: psycopg.Connection, contract_id: str, status: str = "Flagged") -> str:
    finding_id = f"finding_{uuid.uuid4()}"
    now = datetime.now(UTC)
    conn.execute(
        "INSERT INTO findings (id, contract_id, severity, slither_detector, slither_confidence,"
        " raw_output, raw_output_reference, llm_explanation, explanation_source, status,"
        " status_history, created_at)"
        " VALUES (%s, %s, 'High', 'reentrancy-eth', 'Medium', %s, %s, 'x', 'slither', %s, %s, %s)",
        (
            finding_id,
            contract_id,
            Jsonb({"check": "reentrancy-eth"}),
            f"/api/findings/{finding_id}/raw",
            status,
            Jsonb([{"status": "Flagged", "changedAt": now.isoformat()}]),
            now,
        ),
    )
    conn.commit()
    return finding_id
