import { Pool } from "pg";
import { buildApp } from "./app.js";
import { createAuditorStakingFromConfig } from "./chain/clients.js";
import { claimLockEnabled, loadChainConfig } from "./chain/config.js";
import { PgContractRepository } from "./contracts/pg-repository.js";
import { PgPipelineRepository } from "./pipeline/pg-repository.js";
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

// CHAIN_RPC_URL selects the chain. The on-chain lock on claim is off unless
// CLAIM_LOCK_ENABLED=true, because a lock with no unlock (plan item 6) can
// strand an auditor's stake.
const chainConfig = loadChainConfig(process.env);

const app = buildApp({
  repository: pool ? new PgContractRepository(pool) : undefined,
  pipeline: pool ? new PgPipelineRepository(pool) : undefined,
  storage: storageDir ? new LocalSourceStorage(storageDir) : new MemorySourceStorage(),
  auditorStaking: chainConfig && claimLockEnabled(process.env) ? createAuditorStakingFromConfig(chainConfig) : undefined,
});
const port = Number(process.env.PORT ?? 3001);

// app.ts builds Fastify with `logger: false` (keeps tests quiet), so
// lifecycle messages go to the console directly.
async function start(): Promise<void> {
  if (pool && migrateOnBoot) {
    const applied = await runMigrations(pool);
    console.log(`@bbm/api applied migrations: ${applied.join(", ") || "(none)"}`);
  }
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`@bbm/api listening on port ${port}`);
}

/** How long a graceful shutdown may take before the process is forced out. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    console.error(`@bbm/api received ${signal} again, forcing exit`);
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`@bbm/api received ${signal}, shutting down`);
  setTimeout(() => {
    console.error(`@bbm/api shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS} ms, forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  try {
    await app.close();
    await pool?.end();
    process.exit(0);
  } catch (err) {
    console.error("@bbm/api shutdown failed", err);
    process.exit(1);
  }
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));

start().catch((err: unknown) => {
  console.error("@bbm/api failed to start", err);
  process.exit(1);
});
