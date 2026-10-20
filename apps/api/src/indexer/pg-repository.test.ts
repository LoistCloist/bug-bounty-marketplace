import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { runMigrations } from "../db/migrate.js";
import { PgIndexerLock, PgIndexerRepository } from "./pg-repository.js";

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
    await pool.query("DELETE FROM indexer_pending_events WHERE chain_id = $1", [chainId + 2]);
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

  it("never moves a checkpoint backwards", async () => {
    const repo = new PgIndexerRepository(pool);
    const ahead = chainId + 1;
    await repo.setCheckpoint(ahead, 100n);
    await repo.setCheckpoint(ahead, 40n);
    await expect(repo.getCheckpoint(ahead)).resolves.toBe(100n);
    await repo.setCheckpoint(ahead, 101n);
    await expect(repo.getCheckpoint(ahead)).resolves.toBe(101n);
    await pool.query("DELETE FROM indexer_checkpoints WHERE chain_id = $1", [ahead]);
  });

  it("stores, lists in block order, removes and prunes pending logs", async () => {
    const repo = new PgIndexerRepository(pool);
    const pendingChain = chainId + 2;
    const address = "0x00000000000000000000000000000000000000aa" as Address;
    const topics = [`0x${"aa".repeat(32)}` as Hex];
    const late = { chainId: pendingChain, txHash, logIndex: 1, address, topics, data: "0x" as Hex, blockNumber: 2n ** 60n };
    const early = { ...late, logIndex: 0, blockNumber: 5n };

    await repo.addPending(late);
    await repo.addPending(early);
    await repo.addPending(early);
    const listed = await repo.listPending(pendingChain);
    expect(listed.map((p) => [p.blockNumber, p.logIndex])).toEqual([
      [5n, 0],
      [2n ** 60n, 1],
    ]);
    expect(listed[1]!.topics).toEqual(topics);

    await expect(repo.prunePending(pendingChain, 6n)).resolves.toBe(1);
    await repo.removePending({ chainId: pendingChain, txHash, logIndex: 1 });
    await expect(repo.listPending(pendingChain)).resolves.toEqual([]);
  });
});

describe.skipIf(!databaseUrl)("PgIndexerLock", () => {
  it("lets one holder in at a time and frees the lock on release", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    try {
      const first = new PgIndexerLock(pool);
      const second = new PgIndexerLock(pool);

      await expect(first.tryAcquire()).resolves.toBe(true);
      await expect(second.tryAcquire()).resolves.toBe(false);
      await first.release();
      await expect(second.tryAcquire()).resolves.toBe(true);
      await second.release();
    } finally {
      await pool.end();
    }
  });
});
