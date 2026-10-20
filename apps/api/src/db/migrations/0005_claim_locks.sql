-- Chain action bookkeeping: the on-chain claim lock, and markers that make
-- each BountyEscrow write happen at most once. Migrations re-run on every
-- boot, so every change is guarded by a catalog check: ALTER TABLE takes an
-- ACCESS EXCLUSIVE lock even when the column already exists (see 0002).

DO $$
BEGIN
  -- 'locked': the current claim holds an AuditorStaking lock.
  -- 'released': that lock has been unlocked. NULL: the claim was never
  -- locked (CLAIM_LOCK_ENABLED off, or the lock failed).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'contracts'
       AND column_name = 'claim_lock_status'
  ) THEN
    ALTER TABLE contracts ADD COLUMN claim_lock_status TEXT
      CHECK (claim_lock_status IN ('locked', 'released'));
  END IF;
  -- Set once BountyEscrow.recordSubmission has confirmed for this contract.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'contracts'
       AND column_name = 'submission_recorded_at'
  ) THEN
    ALTER TABLE contracts ADD COLUMN submission_recorded_at TIMESTAMPTZ;
  END IF;
  -- Set once BountyEscrow.recordVerification has confirmed for this finding.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'findings'
       AND column_name = 'verification_recorded_at'
  ) THEN
    ALTER TABLE findings ADD COLUMN verification_recorded_at TIMESTAMPTZ;
  END IF;
  -- Set once BountyEscrow.payout has confirmed for this finding.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'findings'
       AND column_name = 'payout_sent_at'
  ) THEN
    ALTER TABLE findings ADD COLUMN payout_sent_at TIMESTAMPTZ;
  END IF;
END
$$;
