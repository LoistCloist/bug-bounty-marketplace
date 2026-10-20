-- Adds the 'unlocking' claim lock state: an unlock is intended but not yet
-- confirmed on-chain, so the sweep must finish it (see chain/actions.ts).
-- Migrations re-run on every boot, so the constraint is only replaced when
-- it does not already allow 'unlocking'.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'contracts'::regclass
       AND conname = 'contracts_claim_lock_status_check'
       AND pg_get_constraintdef(oid) NOT LIKE '%unlocking%'
  ) THEN
    ALTER TABLE contracts DROP CONSTRAINT contracts_claim_lock_status_check;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'contracts'::regclass
       AND conname = 'contracts_claim_lock_status_check'
  ) THEN
    ALTER TABLE contracts ADD CONSTRAINT contracts_claim_lock_status_check
      CHECK (claim_lock_status IN ('locked', 'unlocking', 'released'));
  END IF;
END
$$;
