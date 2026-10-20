import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrate.js";
import { PgIndexerRepository } from "./pg-repository.js";

// Runs only when a Postgres instance is configured, e.g.
// DATABASE_URL=postgres://bbm:bbm@localhost:5432/bbm pnpm --filter @bbm/api test
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("PgIndexerRepository", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  // Random chain id per run, so runs against a shared database do not collide.
  const chainId = 900_000_000 + Math.floor(Math.random() * 99_000_000);
  const txHash = `0x${randomUUID().replace(/-/g, "").padEnd(64, "0")}`;

  beforeAll(async () => {
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM indexer_applied_events WHERE chain_id = $1", [chainId]);
    await pool.query("DELETE FROM indexer_checkpoints WHERE chain_id = $1", [chainId]);
    await pool.end();
  });

  it("stores checkpoints past 2^53 without losing precision", async () => {
    const repo = new PgIndexerRepository(pool);
    const big = 2n ** 60n + 7n;

    await expect(repo.getCheckpoint(chainId)).resolves.toBeNull();
    await repo.setCheckpoint(chainId, 5n);
    await repo.setCheckpoint(chainId, big);
    await expect(repo.getCheckpoint(chainId)).resolves.toBe(big);
  });

  it("records an applied event once", async () => {
    const repo = new PgIndexerRepository(pool);
    const key = { chainId, txHash, logIndex: 3 };
    const appliedAt = new Date("2026-10-20T12:00:00Z");

    await expect(repo.hasApplied(key)).resolves.toBe(false);
    await repo.markApplied({ ...key, eventName: "FindingVerified", appliedAt });
    await repo.markApplied({ ...key, eventName: "FindingVerified", appliedAt });
    await expect(repo.hasApplied(key)).resolves.toBe(true);
  });
});
