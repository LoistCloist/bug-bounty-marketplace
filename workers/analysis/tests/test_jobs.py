from datetime import UTC, datetime, timedelta
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from analysis.jobs import Job, claim_next, complete, expire_exhausted, fail

from .conftest import insert_job

LEASE = 600
MAX = 3


def _job_row(conn, job_id):
    return conn.execute("SELECT * FROM jobs WHERE id = %s", (job_id,)).fetchone()


def test_no_jobs_returns_none(pg_conn):
    assert claim_next(pg_conn, LEASE, MAX) is None


def test_claims_oldest_queued_job_and_marks_it_running(pg_conn):
    old = insert_job(
        pg_conn, "analysis", "contract_a", created_at=datetime.now(UTC) - timedelta(minutes=5)
    )
    insert_job(pg_conn, "sandbox", "poc_b")
    job = claim_next(pg_conn, LEASE, MAX)
    assert job == Job(id=old, kind="analysis", subject_id="contract_a", attempts=1)
    row = _job_row(pg_conn, old)
    assert row["status"] == "running"
    assert row["lease_expires_at"] > datetime.now(UTC) + timedelta(seconds=LEASE - 30)


def test_two_connections_claim_different_jobs(pg_conn, test_database_url):
    insert_job(pg_conn, "analysis", "contract_a")
    insert_job(pg_conn, "analysis", "contract_b")
    other = psycopg.connect(test_database_url, row_factory=dict_row)
    try:
        first = claim_next(pg_conn, LEASE, MAX)
        second = claim_next(other, LEASE, MAX)
    finally:
        other.close()
    assert first is not None and second is not None
    assert first.id != second.id


def test_running_job_with_expired_lease_is_reclaimed(pg_conn):
    stale = insert_job(
        pg_conn,
        "analysis",
        "contract_a",
        status="running",
        attempts=1,
        lease_expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    job = claim_next(pg_conn, LEASE, MAX)
    assert job is not None and job.id == stale and job.attempts == 2


def test_running_job_with_live_lease_is_not_reclaimed(pg_conn):
    insert_job(
        pg_conn,
        "analysis",
        "contract_a",
        status="running",
        attempts=1,
        lease_expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    assert claim_next(pg_conn, LEASE, MAX) is None


def test_complete_marks_done_only_when_caller_commits(pg_conn):
    insert_job(pg_conn, "analysis", "contract_a")
    job = claim_next(pg_conn, LEASE, MAX)
    complete(pg_conn, job.id)
    pg_conn.rollback()
    assert _job_row(pg_conn, job.id)["status"] == "running"
    complete(pg_conn, job.id)
    pg_conn.commit()
    row = _job_row(pg_conn, job.id)
    assert row["status"] == "done" and row["lease_expires_at"] is None


def test_retryable_fail_requeues_until_max_attempts(pg_conn):
    insert_job(pg_conn, "analysis", "contract_a")
    job = claim_next(pg_conn, LEASE, MAX)
    fail(pg_conn, job, "docker down", retryable=True, max_attempts=MAX)
    row = _job_row(pg_conn, job.id)
    assert (row["status"], row["last_error"]) == ("queued", "docker down")

    exhausted = Job(id=job.id, kind=job.kind, subject_id=job.subject_id, attempts=MAX)
    fail(pg_conn, exhausted, "docker still down", retryable=True, max_attempts=MAX)
    assert _job_row(pg_conn, job.id)["status"] == "failed"


def test_non_retryable_fail_is_final(pg_conn):
    insert_job(pg_conn, "analysis", "contract_a")
    job = claim_next(pg_conn, LEASE, MAX)
    fail(pg_conn, job, "Unsupported Solidity version: ^0.6.0", retryable=False, max_attempts=MAX)
    row = _job_row(pg_conn, job.id)
    assert (row["status"], row["last_error"]) == ("failed", "Unsupported Solidity version: ^0.6.0")


def test_fail_discards_uncommitted_result_writes(pg_conn, tmp_path: Path):
    insert_job(pg_conn, "analysis", "contract_a")
    job = claim_next(pg_conn, LEASE, MAX)
    pg_conn.execute("UPDATE jobs SET last_error = 'half-written' WHERE id = %s", (job.id,))
    fail(pg_conn, job, "boom", retryable=False, max_attempts=MAX)
    assert _job_row(pg_conn, job.id)["last_error"] == "boom"


def test_expire_exhausted_marks_stuck_jobs_failed(pg_conn):
    stuck = insert_job(
        pg_conn,
        "sandbox",
        "poc_a",
        status="running",
        attempts=MAX,
        lease_expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    assert expire_exhausted(pg_conn, MAX) == 1
    row = _job_row(pg_conn, stuck)
    assert (row["status"], row["last_error"]) == ("failed", "Lease expired after max attempts")
    assert claim_next(pg_conn, LEASE, MAX) is None


def test_claim_next_only_takes_the_requested_kinds(pg_conn):
    insert_job(pg_conn, "sandbox", "poc_a", created_at=datetime.now(UTC) - timedelta(minutes=5))
    analysis = insert_job(pg_conn, "analysis", "contract_b")
    job = claim_next(pg_conn, LEASE, MAX, kinds=("analysis",))
    assert job is not None and job.id == analysis
    assert claim_next(pg_conn, LEASE, MAX, kinds=("analysis",)) is None
