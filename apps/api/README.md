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

## Scripts

- `pnpm --filter @bbm/api dev` — run with hot reload (tsx)
- `pnpm --filter @bbm/api typecheck`
- `pnpm --filter @bbm/api test`
- `pnpm --filter @bbm/api build`

Postgres-backed repository tests run only when `DATABASE_URL` is set; they are
skipped otherwise.
