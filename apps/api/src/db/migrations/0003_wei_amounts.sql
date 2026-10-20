-- Bounty amounts move from ETH in DOUBLE PRECISION to wei in NUMERIC(78,0),
-- matching uint256 on-chain. Existing rows were entered in ETH, so they are
-- converted to wei (x 10^18). NUMERIC(78,0) holds the full uint256 range.
ALTER TABLE bounties
  ALTER COLUMN amount TYPE NUMERIC(78,0)
  USING (amount * 1000000000000000000)::NUMERIC(78,0);
