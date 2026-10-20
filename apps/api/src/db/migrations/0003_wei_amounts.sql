-- Bounty amounts move from ETH in DOUBLE PRECISION to wei in NUMERIC(78,0),
-- matching uint256 on-chain. Existing rows were entered in ETH. The value is
-- read as text first so its decimal form is exact, then scaled by 10^18 in
-- NUMERIC arithmetic, which avoids rounding error from double precision.
--
-- Guarded by the column's current type: migrations re-run on every boot, and
-- ALTER COLUMN ... USING rewrites the column even when the type is unchanged,
-- so an unguarded rerun would scale every amount by 10^18 again.
DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'bounties'
       AND column_name = 'amount'
  ) = 'double precision' THEN
    ALTER TABLE bounties
      ALTER COLUMN amount TYPE NUMERIC(78,0)
      USING (ROUND(amount::text::NUMERIC * 1000000000000000000))::NUMERIC(78,0);
  END IF;
END
$$;
