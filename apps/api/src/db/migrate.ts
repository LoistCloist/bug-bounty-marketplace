import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { parseIntEnv, resolveMigrationsDir } from "../env.js";

/** Arbitrary constant key for the Postgres advisory lock that serialises
 * migration runs across replicas booting at the same time. */
export const MIGRATION_LOCK_KEY = 416_416_001;

/** Applies every `*.sql` file in the migrations dir, in filename order. Each
 * file is expected to be idempotent (`IF NOT EXISTS`) so re-running is safe.
 * The run holds a session-level advisory lock on one pooled client, so
 * concurrent replicas apply migrations one at a time. Waiting for that lock
 * is bounded by `lock_timeout` (`MIGRATION_LOCK_TIMEOUT_MS`, default 60 s),
 * which Postgres applies to `pg_advisory_lock` waits too.
 *
 * If anything fails, the client is destroyed rather than returned to the
 * pool: closing the session frees the advisory lock even if the explicit
 * unlock failed, and the original error is what propagates. */
export async function runMigrations(
  pool: Pool,
  migrationsDir: string = resolveMigrationsDir(process.env.MIGRATIONS_DIR, import.meta.url),
  lockTimeoutMs: number = parseIntEnv(process.env.MIGRATION_LOCK_TIMEOUT_MS, 60_000),
): Promise<string[]> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query("SELECT set_config('lock_timeout', $1, false)", [String(lockTimeoutMs)]);
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await client.query("RESET lock_timeout");
      for (const file of files) {
        const sql = await readFile(path.join(migrationsDir, file), "utf8");
        await client.query(sql);
      }
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      } catch (unlockErr) {
        failed = true;
        console.error("migrate: failed to release advisory lock", unlockErr);
      }
    }
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    if (failed) client.release(true);
    else client.release();
  }
  return files;
}
