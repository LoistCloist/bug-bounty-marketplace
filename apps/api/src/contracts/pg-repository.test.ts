import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrate.js";
import { PgContractRepository } from "./pg-repository.js";

// Runs only when a Postgres instance is configured, e.g.
// DATABASE_URL=postgres://bbm:bbm@localhost:5432/bbm pnpm --filter @bbm/api test
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("PgContractRepository", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const repository = new PgContractRepository(pool);
  const contractId = `contract_${randomUUID()}`;
  const bountyId = `bounty_${randomUUID()}`;
  const jobId = `job_${randomUUID()}`;

  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    // Contract first, so a concurrent backfill can't re-queue a job for it.
    await pool.query("DELETE FROM contracts WHERE id = $1", [contractId]);
    await pool.query("DELETE FROM jobs WHERE subject_id = $1", [contractId]);
    await pool.query("DELETE FROM bounties WHERE id = $1", [bountyId]);
    await pool.end();
  });

  it("inserts a contract with its bounty and reads it back", async () => {
    const contract = {
      id: contractId,
      developerAddress: "0x1234567890123456789012345678901234567890",
      filename: "Vault.sol",
      sourceHash: "a".repeat(64),
      sourceReference: `contracts/${contractId}/${"a".repeat(64)}.sol`,
      bountyId,
      status: "Open" as const,
      createdAt: "2026-10-01T12:00:00.000Z",
      deadline: "2030-01-01T00:00:00.000Z",
    };

    await repository.insertContract({
      contract,
      bounty: {
        id: bountyId,
        contractId,
        amount: "2000000000000000000",
        currency: "ETH",
        fundedAt: "2026-10-01T12:00:00.000Z",
        deadline: "2030-01-01T00:00:00.000Z",
      },
      analysisJob: {
        id: jobId,
        kind: "analysis",
        subjectId: contractId,
        createdAt: "2026-10-01T12:00:00.000Z",
      },
    });

    expect(await repository.findContractById(contractId)).toEqual(contract);
  });

  it("returns null for an unknown id", async () => {
    expect(await repository.findContractById("contract_does_not_exist")).toBeNull();
  });
  it("releaseClaimIfUnlocked ends only the given auditor's claim, and never one with a held lock", async () => {
    const auditor = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    const claim = (lock: string | null) =>
      pool.query(
        `UPDATE contracts SET status = 'Claimed', claimed_by_auditor_id = $2,
                claim_expires_at = now() + interval '10 minutes', claim_lock_status = $3
          WHERE id = $1`,
        [contractId, auditor, lock],
      );
    const row = async () =>
      (
        await pool.query<{
          status: string;
          claimed_by_auditor_id: string | null;
          claim_lock_status: string | null;
        }>("SELECT status, claimed_by_auditor_id, claim_lock_status FROM contracts WHERE id = $1", [
          contractId,
        ])
      ).rows[0];

    await claim("locked");
    await repository.releaseClaimIfUnlocked(contractId, auditor);
    expect(await row()).toMatchObject({
      status: "Claimed",
      claimed_by_auditor_id: auditor,
      claim_lock_status: "locked",
    });

    await claim("released");
    await repository.releaseClaimIfUnlocked(
      contractId,
      "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    );
    expect((await row())?.status).toBe("Claimed");

    await repository.releaseClaimIfUnlocked(contractId, auditor.toLowerCase());
    expect(await row()).toMatchObject({
      status: "Open",
      claimed_by_auditor_id: null,
      claim_lock_status: null,
    });
  });
});
