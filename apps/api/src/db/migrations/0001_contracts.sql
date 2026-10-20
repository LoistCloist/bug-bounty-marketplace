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

CREATE INDEX IF NOT EXISTS contracts_developer_address_idx ON contracts (developer_address);
