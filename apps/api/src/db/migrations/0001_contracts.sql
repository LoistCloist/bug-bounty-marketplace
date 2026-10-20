-- Contracts and their bounties. Source bytes live in object storage; only the
-- sha256 and storage key are stored here.

CREATE TABLE IF NOT EXISTS bounties (
  id           TEXT PRIMARY KEY,
  contract_id  TEXT NOT NULL,
  amount       DOUBLE PRECISION NOT NULL CHECK (amount > 0),
  currency     TEXT NOT NULL,
  funded_at    TIMESTAMPTZ NOT NULL,
  deadline     TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id                TEXT PRIMARY KEY,
  developer_address TEXT NOT NULL CHECK (developer_address ~ '^0x[a-fA-F0-9]{40}$'),
  filename          TEXT NOT NULL,
  source_hash       TEXT NOT NULL,
  source_reference  TEXT NOT NULL,
  bounty_id         TEXT NOT NULL REFERENCES bounties (id),
  status            TEXT NOT NULL CHECK (status IN ('Open', 'Claimed', 'Resolved', 'Expired')),
  created_at        TIMESTAMPTZ NOT NULL,
  deadline          TIMESTAMPTZ NOT NULL
);

-- Guarded by a catalog check, as in 0002: CREATE INDEX IF NOT EXISTS takes a
-- SHARE lock on the table even when the index exists, and this file re-runs on
-- every boot. That lock conflicts with concurrent writes and can deadlock them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema() AND indexname = 'contracts_developer_address_idx'
  ) THEN
    CREATE INDEX contracts_developer_address_idx ON contracts (developer_address);
  END IF;
END
$$;
