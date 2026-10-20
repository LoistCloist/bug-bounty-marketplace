import { Pool } from "pg";
import { runMigrations } from "./migrate.js";

// One-shot migration runner (`pnpm --filter @bbm/api migrate`), e.g. for a
// release job when the API itself runs with MIGRATE_ON_BOOT=false.
async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("migrate: DATABASE_URL is required (e.g. postgres://user:pass@host:5432/db)");
    return 1;
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const applied = await runMigrations(pool);
    console.log(`migrate: applied ${applied.length} file(s): ${applied.join(", ") || "(none)"}`);
    return 0;
  } catch (err) {
    console.error("migrate: failed", err);
    return 1;
  } finally {
    await pool.end();
  }
}

main().then((code) => process.exit(code));
