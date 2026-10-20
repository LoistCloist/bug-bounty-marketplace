import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIGRATION_LOCK_KEY, runMigrations } from "./migrate.js";

const LOCK = `SELECT pg_advisory_lock($1)`;
const UNLOCK = `SELECT pg_advisory_unlock($1)`;
const SET_TIMEOUT = `SELECT set_config('lock_timeout', $1, false)`;
const RESET_TIMEOUT = `RESET lock_timeout`;

/** Fake pg Pool/client that records every call in order; `failOn` maps a SQL
 * string to the error its query should reject with. No DB, no network. */
function fakePool(failOn: Record<string, Error> = {}) {
  const calls: unknown[][] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push(params === undefined ? ["query", sql] : ["query", sql, params]);
      const err = failOn[sql];
      if (err) throw err;
      return { rows: [] };
    }),
    release: vi.fn((destroy?: boolean) => {
      calls.push(destroy === undefined ? ["release"] : ["release", destroy]);
    }),
  };
  const pool = {
    connect: vi.fn(async () => {
      calls.push(["connect"]);
      return client;
    }),
  };
  return { pool: pool as unknown as Pool, client, calls };
}

describe("runMigrations", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "bbm-migrate-"));
    // Written out of order; must be applied in filename order.
    await writeFile(path.join(dir, "002_b.sql"), "-- b");
    await writeFile(path.join(dir, "001_a.sql"), "-- a");
    await writeFile(path.join(dir, "003_c.sql"), "-- c");
    await writeFile(path.join(dir, "README.md"), "not a migration");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("locks, applies files in filename order, unlocks, then releases", async () => {
    const { pool, calls } = fakePool();
    const applied = await runMigrations(pool, dir, 1234);

    expect(applied).toEqual(["001_a.sql", "002_b.sql", "003_c.sql"]);
    expect(calls).toEqual([
      ["connect"],
      ["query", SET_TIMEOUT, ["1234"]],
      ["query", LOCK, [MIGRATION_LOCK_KEY]],
      ["query", RESET_TIMEOUT],
      ["query", "-- a"],
      ["query", "-- b"],
      ["query", "-- c"],
      ["query", UNLOCK, [MIGRATION_LOCK_KEY]],
      ["release"],
    ]);
  });

  it("still unlocks and destroys the client when a migration fails, rethrowing the original error", async () => {
    const boom = new Error("syntax error in 002");
    const { pool, calls } = fakePool({ "-- b": boom });

    await expect(runMigrations(pool, dir, 1234)).rejects.toBe(boom);
    expect(calls.slice(-4)).toEqual([
      ["query", "-- a"],
      ["query", "-- b"],
      ["query", UNLOCK, [MIGRATION_LOCK_KEY]],
      ["release", true],
    ]);
    expect(calls).not.toContainEqual(["query", "-- c"]);
  });

  it("does not let an unlock failure mask the original error", async () => {
    const boom = new Error("syntax error in 002");
    const unlockErr = new Error("connection reset");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pool, calls } = fakePool({ "-- b": boom, [UNLOCK]: unlockErr });

    await expect(runMigrations(pool, dir, 1234)).rejects.toBe(boom);
    expect(calls.at(-1)).toEqual(["release", true]);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("advisory lock"), unlockErr);
  });

  it("destroys the client when only the unlock fails, still returning the applied files", async () => {
    const unlockErr = new Error("connection reset");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pool, calls } = fakePool({ [UNLOCK]: unlockErr });

    await expect(runMigrations(pool, dir, 1234)).resolves.toEqual([
      "001_a.sql",
      "002_b.sql",
      "003_c.sql",
    ]);
    expect(calls.at(-1)).toEqual(["release", true]);
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("gives up when the lock wait exceeds lock_timeout, without unlocking or running files", async () => {
    const timeout = new Error("canceling statement due to lock timeout");
    const { pool, calls } = fakePool({ [LOCK]: timeout });

    await expect(runMigrations(pool, dir, 50)).rejects.toBe(timeout);
    expect(calls).toEqual([
      ["connect"],
      ["query", SET_TIMEOUT, ["50"]],
      ["query", LOCK, [MIGRATION_LOCK_KEY]],
      ["release", true],
    ]);
  });

  it("defaults the lock timeout from MIGRATION_LOCK_TIMEOUT_MS, else 60000", async () => {
    vi.stubEnv("MIGRATION_LOCK_TIMEOUT_MS", "");
    const first = fakePool();
    await runMigrations(first.pool, dir);
    expect(first.calls[1]).toEqual(["query", SET_TIMEOUT, ["60000"]]);

    vi.stubEnv("MIGRATION_LOCK_TIMEOUT_MS", "5000");
    const second = fakePool();
    await runMigrations(second.pool, dir);
    expect(second.calls[1]).toEqual(["query", SET_TIMEOUT, ["5000"]]);
  });
});
