-- Bounty amounts move from ETH in DOUBLE PRECISION to wei in NUMERIC(78,0),
-- matching uint256 on-chain. Existing rows were entered in ETH. The value is
-- read as text first so its decimal form is exact, then scaled by 10^18 in
-- NUMERIC arithmetic, which avoids rounding error from double precision.
ALTER TABLE bounties
  ALTER COLUMN amount TYPE NUMERIC(78,0)
  USING (ROUND(amount::text::NUMERIC * 1000000000000000000))::NUMERIC(78,0);
