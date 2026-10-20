# @bbm/api

Fastify app. Exposes `GET /health` and contract source upload:

- `POST /api/contracts` — multipart `file` (`.sol`, at most 100 KB) plus
  `developerAddress`, `bountyAmount`, `currency` (default `ETH`), `deadline`.
  Returns `201` with the `Contract`.
- `GET /api/contracts/:id` — returns the `Contract`, or `404`.

Storage is pluggable. Contracts use a `ContractRepository` (in-memory, or
Postgres via `DATABASE_URL`). Source bytes use a `SourceStorage` (in-memory,
or local disk via `SOURCE_STORAGE_DIR`). See the root README for the
environment variables and the local Postgres setup.

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port (binds `0.0.0.0`). |
| `DATABASE_URL` | unset | Unset: contracts are held in memory. Set: Postgres-backed repository. |
| `MIGRATE_ON_BOOT` | `true` | With `DATABASE_URL`, apply migrations at startup. `false`/`0`/`no`/`off` disables it (run `migrate` as a separate step instead). |
| `PG_POOL_MAX` | `5` | Maximum connections in the Postgres pool. |
| `MIGRATIONS_DIR` | `migrations/` next to the running module | Directory of `*.sql` migrations. Resolves to `src/db/migrations` under `dev` and `dist/migrations` in the build. |
| `SOURCE_STORAGE_DIR` | unset | Unset: uploaded `.sol` bytes are held in memory. Set: written under this directory. |

Migrations are applied in filename order while holding a Postgres advisory
lock, so several replicas booting at once apply them one at a time.

## Scripts

- `pnpm --filter @bbm/api dev` — run from source with hot reload (tsx)
- `pnpm --filter @bbm/api typecheck`
- `pnpm --filter @bbm/api test`
- `pnpm --filter @bbm/api build` — typecheck, then bundle `src/index.ts` and
  `src/db/migrate-cli.ts` into `dist/` with esbuild (`build.mjs`) and copy the
  SQL migrations to `dist/migrations/`. `@bbm/shared` and its dependencies
  are inlined; `fastify`, `@fastify/multipart` and `pg` stay external, so a
  runtime image needs `dist/` plus the API's production `node_modules`.
- `pnpm --filter @bbm/api start` — `node dist/index.js`; SIGTERM/SIGINT close
  the server and the pool, then exit 0.
- `pnpm --filter @bbm/api migrate` — `node dist/migrate-cli.js`; applies the
  migrations against `DATABASE_URL` (required) and exits.

Postgres-backed repository tests run only when `DATABASE_URL` is set; they are
skipped otherwise.
