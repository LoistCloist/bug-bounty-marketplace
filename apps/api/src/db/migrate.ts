import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { resolveMigrationsDir } from "../env.js";

/** Arbitrary constant key for the Postgres advisory lock that serialises
 * migration runs across replicas booting at the same time. */
export const MIGRATION_LOCK_KEY = 416_416_001;

/** Applies every `*.sql` file in the migrations dir, in filename order. Each
 * file is expected to be idempotent (`IF NOT EXISTS`) so re-running is safe.
 * The run holds a session-level advisory lock on one pooled client, so
 * concurrent replicas apply migrations one at a time. */
export async function runMigrations(
  pool: Pool,
  migrationsDir: string = resolveMigrationsDir(process.env.MIGRATIONS_DIR, import.meta.url),
): Promise<string[]> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      for (const file of files) {
        const sql = await readFile(path.join(migrationsDir, file), "utf8");
        await client.query(sql);
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
  return files;
}
