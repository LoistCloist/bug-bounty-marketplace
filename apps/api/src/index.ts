import { Pool } from "pg";
import { buildApp } from "./app.js";
import { PgContractRepository } from "./contracts/pg-repository.js";
import { LocalSourceStorage, MemorySourceStorage } from "./contracts/storage.js";
import { runMigrations } from "./db/migrate.js";
import { parseBoolEnv, parseIntEnv } from "./env.js";

// DATABASE_URL selects Postgres. Without it the API keeps contracts in memory,
// which is fine for local UI work and tests. MIGRATE_ON_BOOT (default true)
// applies migrations at startup; PG_POOL_MAX caps the pool (default 5).
// SOURCE_STORAGE_DIR selects local-disk source storage; without it sources
// are held in memory.
const databaseUrl = process.env.DATABASE_URL;
const storageDir = process.env.SOURCE_STORAGE_DIR;
const migrateOnBoot = parseBoolEnv(process.env.MIGRATE_ON_BOOT, true);
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, max: parseIntEnv(process.env.PG_POOL_MAX, 5) })
  : undefined;

const app = buildApp({
  repository: pool ? new PgContractRepository(pool) : undefined,
  storage: storageDir ? new LocalSourceStorage(storageDir) : new MemorySourceStorage(),
});
const port = Number(process.env.PORT ?? 3001);

async function start(): Promise<void> {
  if (pool && migrateOnBoot) {
    const applied = await runMigrations(pool);
    app.log.info(`applied migrations: ${applied.join(", ")}`);
  }
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`@bbm/api listening on port ${port}`);
}

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`received ${signal}, shutting down`);
  try {
    await app.close();
    await pool?.end();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));

start().catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
