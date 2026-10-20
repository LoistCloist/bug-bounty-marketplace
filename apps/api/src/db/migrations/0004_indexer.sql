-- Event indexer state: the last fully processed block per chain, and the
-- chain events already applied to API state. Keyed by (chain, tx hash, log
-- index) so replaying a block never applies an event twice. Idempotent, like
-- every migration here, because it re-runs on each API boot.

CREATE TABLE IF NOT EXISTS indexer_checkpoints (
  chain_id      INTEGER PRIMARY KEY,
  -- Last block whose logs were all applied. The next run re-reads from it.
  block_number  NUMERIC(78,0) NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS indexer_applied_events (
  chain_id      INTEGER NOT NULL,
  tx_hash       TEXT NOT NULL,
  log_index     INTEGER NOT NULL,
  event_name    TEXT NOT NULL,
  applied_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain_id, tx_hash, log_index)
);

-- Logs for findings the API did not know yet when the log was read. Kept
-- until the finding exists (then applied and removed) or until pruned by the
-- optional max age. Stores the raw log so retries never re-read blocks.
CREATE TABLE IF NOT EXISTS indexer_pending_events (
  chain_id      INTEGER NOT NULL,
  tx_hash       TEXT NOT NULL,
  log_index     INTEGER NOT NULL,
  address       TEXT NOT NULL,
  topics        TEXT[] NOT NULL,
  data          TEXT NOT NULL,
  block_number  NUMERIC(78,0) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, tx_hash, log_index)
);
