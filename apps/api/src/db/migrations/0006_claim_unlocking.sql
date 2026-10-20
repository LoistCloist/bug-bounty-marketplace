-- Claim lock states beyond 'locked' and 'released':
--   'locking'   a lock is intended but not yet confirmed. The row keeps the
--               auditor and claim_lock_before (the lock count read before the
--               send), so the sweep can tell whether the lock landed.
--   'unlocking' an unlock is intended but not yet confirmed; the sweep finishes it
--               (see chain/actions.ts).
-- Migrations re-run on every boot, so each change is guarded: the constraint is
-- only replaced when it does not already allow 'locking' and 'unlocking', and
-- the column is only added when it is missing.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'contracts'
       AND column_name = 'claim_lock_before'
  ) THEN
    ALTER TABLE contracts ADD COLUMN claim_lock_before NUMERIC(78, 0);
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'contracts'::regclass
       AND conname = 'contracts_claim_lock_status_check'
       AND (pg_get_constraintdef(oid) NOT LIKE '%''unlocking''%'
            OR pg_get_constraintdef(oid) NOT LIKE '%''locking''%')
  ) THEN
    ALTER TABLE contracts DROP CONSTRAINT contracts_claim_lock_status_check;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'contracts'::regclass
       AND conname = 'contracts_claim_lock_status_check'
  ) THEN
    ALTER TABLE contracts ADD CONSTRAINT contracts_claim_lock_status_check
      CHECK (claim_lock_status IN ('locking', 'locked', 'unlocking', 'released'));
  END IF;
END
$$;
