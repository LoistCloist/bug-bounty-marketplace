# Bug Bounty Marketplace

An AI-assisted smart contract security and bug-bounty marketplace.

A developer submits a Solidity contract and funds a bounty held in on-chain
escrow. Slither runs static analysis; an LLM explains each finding in plain
English (advisory only — it never changes a finding's status or payout). An
auditor stakes a deposit, claims the contract exclusively and time-limitedly,
and submits a Foundry proof-of-concept (PoC). A sandbox re-runs the PoC; only
a successful reproduction marks a finding **Verified**. After the challenge
window passes with no dispute, escrow pays the auditor (first verified PoC
wins, and the bounty closes). The developer can dispute a Verified finding
during the challenge window; an admin arbiter rules, and a losing auditor's
stake is slashed. Auditors can also mark AI findings as false positives.

Finding statuses: `Flagged → Submitted → Verified → Disputed/Rejected → Paid`.

## Repo layout

```
.
├── apps/
│   ├── web/        # Next.js frontend (feat/web-shell-mocks)
│   └── api/         # Fastify API — GET /health scaffolded here
├── packages/
│   └── shared/      # Shared Zod schemas (feat/shared-schemas)
├── workers/         # Non-TS services (Python/Rust) — not a pnpm workspace member
├── contracts/       # Foundry project: escrow, bounty, dispute contracts
├── docs/            # Architecture notes, ADRs
├── docker-compose.yml
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── CLAUDE.md
```

## Setup

```sh
git clone <repo>
cd bug-bounty-marketplace

nvm use                     # Node 20 (see .nvmrc)
corepack enable              # or: npm install -g pnpm@9
pnpm install

pnpm -r typecheck
pnpm -r test
```

### Running the web app (once scaffolded)

```sh
NEXT_PUBLIC_API_MOCKING=enabled pnpm dev
```

With mocking enabled the frontend runs entirely against MSW mock handlers
(`apps/web/src/mocks/handlers/{developer,auditor,arbiter}.ts`), so the full
developer → auditor → arbiter flow can be exercised without a live API,
database, or blockchain.

### Running the API

```sh
pnpm --filter @bbm/api dev
```

Environment variables (all optional):

| Variable | Effect when unset |
| --- | --- |
| `PORT` | Listens on 3001. |
| `DATABASE_URL` | Contracts are held in memory. When set, the API connects to Postgres 16 and applies `apps/api/src/db/migrations` on boot. |
| `SOURCE_STORAGE_DIR` | Uploaded `.sol` bytes are held in memory. When set, they are written under this directory. |

Contract submission is `POST /api/contracts` as `multipart/form-data`, with
fields `file` (a `.sol` file, at most 100 KB), `developerAddress`,
`bountyAmount`, `currency` (default `ETH`) and `deadline`. It returns `201`
with the `Contract`, including `sourceHash` (sha256 of the bytes) and
`sourceReference` (`contracts/<id>/<sha256>.sol`). Errors: `400` for invalid
fields (with an `issues` list), `413` for an oversize file.

### Running contract tests

Requires [Foundry](https://book.getfoundry.sh/):

```sh
cd contracts
forge install foundry-rs/forge-std --no-commit   # one-time
forge build
forge test
```

## CI

`.github/workflows/ci.yml` runs on every push and pull request. A `changes`
job uses `dorny/paths-filter` to decide which jobs run. Each path-filtered
job below runs only when its paths change; `changes` and `CI OK` always run.
Changes to root config (`package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `tsconfig.base.json`, ESLint/Prettier config, the
workflow itself) also trigger web, api and shared, but not contracts.

| Job         | Runs when                                 | What it does                                                                                                                                                         |
| ----------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web`       | `apps/web/**`, `packages/shared/**`, root | `lint`, `typecheck`, `test`, `build` with `--if-present`                                                                                                             |
| `api`       | `apps/api/**`, `packages/shared/**`, root | `lint`, `typecheck`, `test`, `build`, run directly                                                                                                                   |
| `shared`    | `packages/shared/**`, root                | `lint`, `typecheck`, `test` and `gen:schema` with `--if-present`, then `git diff --exit-code -- packages/shared/schema` to fail if tracked generated schemas changed |
| `contracts` | `contracts/**`                            | Installs Foundry and forge-std, runs `forge build` and `forge test -vvv`, then Slither (`crytic/slither-action`) with `fail-on: none`, so Slither is advisory only   |
| `CI OK`     | always                                    | Passes if `changes` succeeded and every other job succeeded or was skipped; fails otherwise                                                                          |

`--if-present` means a package script that doesn't exist is skipped and the
step passes silently. The api job calls its scripts directly, so a missing
script fails the job.

`CI OK` is the required status check on `main` once the checked-in ruleset
is applied (see `TODO.md`). The ruleset is checked in at
`.github/rulesets/main.json` as the source of truth; after changing it, a
repo admin applies it with:

```sh
gh api -X PUT repos/LoistCloist/bug-bounty-marketplace/rulesets/24287837 --input .github/rulesets/main.json
```

CI does not deploy anything.

## Milestone scope

This repo is being built incrementally on `feat/m2-foundation` via small,
reviewed sub-branches (monorepo scaffold → shared schemas → web shell with
mocks → developer/auditor/arbiter flows → CI). See `CLAUDE.md` for the full
workflow and conventions.

## Frontend MVP (BountyGuard)

From the repository root on Windows PowerShell:

```powershell
pnpm install
pnpm dev
```

Open http://localhost:3000. The frontend defaults to the self-contained MSW demo.
No API server, database, wallet extension, or blockchain is needed. The dark
workspace includes an overview, searchable contract portfolio, submission form,
auditor queue with staking and PoC uploads, and dispute review. The in-app
Getting started page includes sample Solidity and PoC files.

Use the sidebar or role selector to switch actors. Navigation preserves the
in-memory demo; a full reload resets it. The displayed wallets, stakes, analysis,
verification, and payments are simulated. Sample PoC files demonstrate uploads,
not working exploits. AI explanations are advisory; only the simulated sandbox
changes verification status.

For a future live API integration, set `NEXT_PUBLIC_API_MOCKING=disabled` before
starting/building, and provide the matching `/api/*` routes. This switch alone
does not implement wallet authentication or on-chain transactions.

If the mock worker needs regeneration after an MSW dependency change:

```powershell
pnpm --filter @bbm/web exec msw init public --save
```

Frontend checks: `pnpm --filter @bbm/web typecheck`, `pnpm --filter @bbm/web lint`,
`pnpm --filter @bbm/web test`, and `pnpm --filter @bbm/web build`.
