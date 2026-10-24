-- On-chain lifecycle (docs/superpowers/specs/2026-10-20-onchain-lifecycle-design.md).
-- verdict_applied_at: when the API applied the sandbox verdict through chain
-- actions (the worker only records sandbox_status when a chain is configured).
-- disputes: one per finding, opened by the developer on-chain and ruled by the
-- arbiter on-chain; the API mirrors them for the arbiter view.
ALTER TABLE poc_submissions ADD COLUMN IF NOT EXISTS verdict_applied_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL UNIQUE REFERENCES findings(id),
  contract_id TEXT NOT NULL REFERENCES contracts(id),
  developer_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL,
  challenge_window_expires_at TIMESTAMPTZ,
  ruling TEXT NOT NULL DEFAULT 'Pending'
    CHECK (ruling IN ('Pending', 'ForAuditor', 'AgainstAuditor')),
  ruled_at TIMESTAMPTZ,
  arbiter_id TEXT
);
