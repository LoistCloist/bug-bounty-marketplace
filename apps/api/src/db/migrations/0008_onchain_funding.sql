-- When the developer's bounty was confirmed funded on BountyEscrow. Set only by
-- POST /api/contracts/:id/funded after reading the chain; with a chain
-- configured, only contracts with it set are listed for auditors.
-- (bounties.funded_at stays the upload time; it is NOT NULL in the shared
-- Bounty schema.)
ALTER TABLE bounties ADD COLUMN IF NOT EXISTS onchain_funded_at TIMESTAMPTZ;
