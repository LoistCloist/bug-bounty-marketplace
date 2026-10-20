# @bbm/api

Fastify app. Exposes `GET /health` and contract source upload:

- `POST /api/contracts` — multipart `file` (`.sol`, at most 100 KB) plus
  `developerAddress`, `bountyAmount`, `currency` (default `ETH`), `deadline`.
  Returns `201` with the `Contract`.
- `GET /api/contracts/:id` — returns the `Contract`, or `404`.

Storage is pluggable. Contracts use a `ContractRepository` (in-memory, or
Postgres via `DATABASE_URL`). Source bytes use a `SourceStorage` (in-memory,
or local disk via `SOURCE_STORAGE_DIR`). For a local Postgres, run
`docker compose up -d db` and set
`DATABASE_URL=postgres://bbm:bbm@localhost:5432/bbm`.

## Environment variables

| Variable                    | Default                                  | Effect                                                                                                                           |
| --------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | `3001`                                   | HTTP port (binds `0.0.0.0`).                                                                                                     |
| `DATABASE_URL`              | unset                                    | Unset: contracts are held in memory. Set: Postgres-backed repository.                                                            |
| `MIGRATE_ON_BOOT`           | `true`                                   | With `DATABASE_URL`, apply migrations at startup. `false`/`0`/`no`/`off` disables it (run `migrate` as a separate step instead). |
| `PG_POOL_MAX`               | `5`                                      | Maximum connections in the Postgres pool.                                                                                        |
| `MIGRATION_LOCK_TIMEOUT_MS` | `60000`                                  | How long a migration run waits for the advisory lock (via `lock_timeout`) before failing.                                        |
| `MIGRATIONS_DIR`            | `migrations/` next to the running module | Directory of `*.sql` migrations. Resolves to `src/db/migrations` under `dev` and `dist/migrations` in the build.                 |
| `SOURCE_STORAGE_DIR`        | unset                                    | Unset: uploaded `.sol` bytes are held in memory. Set: written under this directory.                                              |

Migrations are applied in filename order while holding a Postgres advisory
lock, so several replicas booting at once apply them one at a time. If a run
fails, its connection is discarded so the lock is always freed.

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
  the server and the pool, then exit 0. A second signal, or a close that takes
  longer than 10 s, forces exit 1.
- `pnpm --filter @bbm/api migrate` — `node dist/migrate-cli.js`; applies the
  migrations against `DATABASE_URL` (required) and exits.

Postgres-backed repository tests run only when `DATABASE_URL` is set; they are
skipped otherwise. CI's `api` job sets it (Postgres service container), then
boots the built `dist/index.js` and waits for `/health`. End-to-end checks of
the API through the web proxy live in [`tests/`](../tests/README.md).

## Container image

`apps/api/Dockerfile` builds a production image. Build it from the repo root
with BuildKit (it uses a cache mount for the pnpm store):

```sh
docker build -f apps/api/Dockerfile -t bbm-api .
docker run -p 3001:3001 -e DATABASE_URL=postgres://... bbm-api
docker run --rm -e DATABASE_URL=postgres://... bbm-api node dist/migrate-cli.js
```

The runtime stage holds only `dist/` plus the production `node_modules` from
`pnpm deploy --prod`, runs as `node`, and listens on `PORT` (default `3001`).
`SOURCE_STORAGE_DIR` defaults to `/data/sources`, the only writable directory;
mount a volume there to keep uploaded sources. The healthcheck calls
`GET /health`.
