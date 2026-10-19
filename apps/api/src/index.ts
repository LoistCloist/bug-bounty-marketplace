import { Pool } from "pg";
import { buildApp } from "./app.js";
import { PgContractRepository } from "./contracts/pg-repository.js";
import { LocalSourceStorage, MemorySourceStorage } from "./contracts/storage.js";
import { runMigrations } from "./db/migrate.js";

// DATABASE_URL selects Postgres (migrations run on boot). Without it the API
// keeps contracts in memory, which is fine for local UI work and tests.
// SOURCE_STORAGE_DIR selects local-disk source storage; without it sources
// are held in memory.
const databaseUrl = process.env.DATABASE_URL;
const storageDir = process.env.SOURCE_STORAGE_DIR;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;

const app = buildApp({
  repository: pool ? new PgContractRepository(pool) : undefined,
  storage: storageDir ? new LocalSourceStorage(storageDir) : new MemorySourceStorage(),
});
const port = Number(process.env.PORT ?? 3001);

async function start(): Promise<void> {
  if (pool) {
    const applied = await runMigrations(pool);
    app.log.info(`applied migrations: ${applied.join(", ")}`);
  }
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`@bbm/api listening on port ${port}`);
}

start().catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
