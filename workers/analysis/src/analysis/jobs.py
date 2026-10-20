"""The Postgres job queue shared with the API (`jobs` table).

The API inserts `queued` rows. Workers claim them with FOR UPDATE SKIP LOCKED,
so concurrent workers never take the same job. A claimed job holds a lease;
if the worker dies, the lease expires and another worker retries the job.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import psycopg

_CLAIM = """
UPDATE jobs
   SET status = 'running',
       attempts = attempts + 1,
       lease_expires_at = now() + make_interval(secs => %(lease)s),
       updated_at = now()
 WHERE id = (
   SELECT id FROM jobs
    WHERE (status = 'queued' OR (status = 'running' AND lease_expires_at < now()))
      AND attempts < %(max_attempts)s
      AND kind = ANY(%(kinds)s)
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1)
RETURNING id, kind, subject_id, attempts
"""


@dataclass(frozen=True)
class Job:
    id: str
    kind: Literal["analysis", "sandbox"]
    subject_id: str
    attempts: int


def claim_next(
    conn: psycopg.Connection,
    lease_s: int,
    max_attempts: int,
    kinds: Sequence[str] = ("analysis", "sandbox"),
) -> Job | None:
    """Claims the oldest available job of one of `kinds` and commits the claim."""
    row = conn.execute(
        _CLAIM, {"lease": lease_s, "max_attempts": max_attempts, "kinds": list(kinds)}
    ).fetchone()
    conn.commit()
    if row is None:
        return None
    return Job(
        id=row["id"], kind=row["kind"], subject_id=row["subject_id"], attempts=row["attempts"]
    )


def complete(conn: psycopg.Connection, job_id: str) -> None:
    """Marks the job done. Does not commit: the caller commits it together
    with the job's result rows, so results and status land atomically."""
    conn.execute(
        "UPDATE jobs SET status = 'done', lease_expires_at = NULL, last_error = NULL,"
        " updated_at = now() WHERE id = %s",
        (job_id,),
    )


def fail(
    conn: psycopg.Connection, job: Job, reason: str, retryable: bool, max_attempts: int
) -> None:
    """Records a failure and commits. Any uncommitted result writes from the
    failed attempt are rolled back first. A retryable failure with attempts
    left goes back to `queued`; anything else is final (`failed`)."""
    conn.rollback()
    status = "queued" if retryable and job.attempts < max_attempts else "failed"
    conn.execute(
        "UPDATE jobs SET status = %s, last_error = %s, lease_expires_at = NULL,"
        " updated_at = now() WHERE id = %s",
        (status, reason, job.id),
    )
    conn.commit()


def expire_exhausted(conn: psycopg.Connection, max_attempts: int) -> int:
    """Fails running jobs whose lease ran out on their last attempt (the worker
    died mid-job too many times). Returns how many were failed."""
    cur = conn.execute(
        "UPDATE jobs SET status = 'failed', last_error = 'Lease expired after max attempts',"
        " lease_expires_at = NULL, updated_at = now()"
        " WHERE status = 'running' AND lease_expires_at < now() AND attempts >= %s",
        (max_attempts,),
    )
    conn.commit()
    return cur.rowcount
