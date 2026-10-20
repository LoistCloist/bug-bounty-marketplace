-- Analysis pipeline: findings, PoC submissions, and the job queue shared with
-- the Python worker (workers/analysis). The worker's tests apply these files
-- too, so keep every statement idempotent.

-- The active claim lives on the contract. It is not part of the shared
-- Contract schema; the API maps it onto each Finding instead.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS claimed_by_auditor_id TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS findings (
  id                          TEXT PRIMARY KEY,
  contract_id                 TEXT NOT NULL REFERENCES contracts (id),
  severity                    TEXT NOT NULL CHECK (severity IN ('Critical', 'High', 'Medium', 'Low', 'Informational')),
  slither_detector            TEXT NOT NULL,
  slither_confidence          TEXT NOT NULL,
  -- This detector's entry from Slither's JSON report, verbatim.
  raw_output                  JSONB NOT NULL,
  -- "/api/findings/<id>/raw"
  raw_output_reference        TEXT NOT NULL,
  llm_explanation             TEXT NOT NULL,
  explanation_source          TEXT NOT NULL CHECK (explanation_source IN ('llm', 'slither')),
  status                      TEXT NOT NULL CHECK (status IN ('Flagged', 'Submitted', 'Verified', 'Disputed', 'Rejected', 'Paid')),
  status_history              JSONB NOT NULL,
  is_false_positive           BOOLEAN NOT NULL DEFAULT false,
  challenge_window_expires_at TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS findings_contract_id_idx ON findings (contract_id);

CREATE TABLE IF NOT EXISTS poc_submissions (
  id                  TEXT PRIMARY KEY,
  finding_id          TEXT NOT NULL REFERENCES findings (id),
  auditor_id          TEXT NOT NULL,
  -- "pocs/<pocId>/<sha256>.t.sol" in source storage
  test_file_reference TEXT NOT NULL,
  submitted_at        TIMESTAMPTZ NOT NULL,
  sandbox_status      TEXT NOT NULL CHECK (sandbox_status IN ('Pending', 'Passed', 'Failed')),
  sandbox_log         TEXT
);

CREATE INDEX IF NOT EXISTS poc_submissions_finding_id_idx ON poc_submissions (finding_id);

CREATE TABLE IF NOT EXISTS jobs (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('analysis', 'sandbox')),
  -- Contract id for analysis jobs, PoC id for sandbox jobs.
  subject_id       TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts         INT  NOT NULL DEFAULT 0,
  last_error       TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_claimable_idx ON jobs (status, created_at);
CREATE INDEX IF NOT EXISTS jobs_subject_idx ON jobs (subject_id);
