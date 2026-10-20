import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";

// Runs only when a Postgres instance is configured (see pg-repository tests).
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("migration 0002", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const contractId = `contract_${randomUUID()}`;
  const bountyId = `bounty_${randomUUID()}`;

  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM jobs WHERE subject_id = $1", [contractId]);
    await pool.query("DELETE FROM contracts WHERE id = $1", [contractId]);
    await pool.query("DELETE FROM bounties WHERE id = $1", [bountyId]);
    await pool.end();
  });

  it("re-runs without waiting on readers of contracts (no ACCESS EXCLUSIVE lock)", async () => {
    const reader = await pool.connect();
    try {
      // A worker reading a contract mid-analysis holds ACCESS SHARE until commit.
      await reader.query("BEGIN");
      await reader.query("SELECT 1 FROM contracts LIMIT 1");
      const rerun = runMigrations(pool);
      const timedOut = new Promise((resolve) => setTimeout(() => resolve("timed out"), 5_000));
      expect(await Promise.race([rerun.then(() => "done"), timedOut])).toBe("done");
    } finally {
      await reader.query("ROLLBACK");
      reader.release();
    }
  });

  it("queues an analysis job for a contract that was stored before the pipeline existed", async () => {
    await pool.query(
      `INSERT INTO bounties (id, contract_id, amount, currency, funded_at, deadline)
       VALUES ($1, $2, 1, 'ETH', now(), '2030-01-01T00:00:00Z')`,
      [bountyId, contractId],
    );
    await pool.query(
      `INSERT INTO contracts (id, developer_address, filename, source_hash, source_reference,
         bounty_id, status, created_at, deadline)
       VALUES ($1, $2, 'Old.sol', 'h', 'contracts/x/h.sol', $3, 'Open', now(), '2030-01-01T00:00:00Z')`,
      [contractId, "0x" + "1".repeat(40), bountyId],
    );
    await runMigrations(pool);
    await runMigrations(pool);
    const jobs = await pool.query("SELECT kind, status FROM jobs WHERE subject_id = $1", [
      contractId,
    ]);
    expect(jobs.rows).toEqual([{ kind: "analysis", status: "queued" }]);
  });
});
