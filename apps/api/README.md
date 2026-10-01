# @bbm/api

Minimal Fastify app scaffold. Currently exposes `GET /health` only; real routes
(contract submission, bounty escrow, findings, auditor claims, etc.) are added
in later branches.

## Scripts

- `pnpm --filter @bbm/api dev` — run with hot reload (tsx)
- `pnpm --filter @bbm/api typecheck`
- `pnpm --filter @bbm/api test`
- `pnpm --filter @bbm/api build`
