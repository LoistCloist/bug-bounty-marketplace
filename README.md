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
(`apps/web/mocks/handlers/{developer,auditor,arbiter}.ts`), so the full
developer → auditor → arbiter flow can be exercised without a live API,
database, or blockchain.

### Running the API

```sh
pnpm --filter @bbm/api dev
```

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
job uses `dorny/paths-filter` to decide which jobs run. Each job below runs
only when its paths change. Changes to root config (`package.json`,
lockfile, `tsconfig.base.json`, ESLint/Prettier config, the workflow itself)
also trigger web, api and shared, but not contracts.

| Job         | Runs when                                | What it does                                                                                                                                                       |
| ----------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `web`       | `apps/web/**`, `packages/shared/**`, root | `lint`, `typecheck`, `test`, `build` with `--if-present`                                                                                                           |
| `api`       | `apps/api/**`, `packages/shared/**`, root | `lint`, `typecheck`, `test`, `build`, run directly                                                                                                                 |
| `shared`    | `packages/shared/**`, root                | `lint`, `typecheck`, `test` with `--if-present`, then `gen:schema` and `git diff --exit-code -- packages/shared/schema` to fail on stale generated schemas         |
| `contracts` | `contracts/**`                            | Installs Foundry and forge-std, runs `forge build` and `forge test -vvv`, then Slither (`crytic/slither-action`) with `fail-on: none`, so Slither is advisory only |
| `CI OK`     | always                                    | Passes if every other job succeeded or was skipped; fails otherwise                                                                                                |

`--if-present` means a package script that doesn't exist is skipped and the
step passes silently. The api job calls its scripts directly, so a missing
script fails the job.

`CI OK` is the required status check on `main`. The ruleset is checked in
at `.github/rulesets/main.json`; a repo admin applies it with:

```sh
gh api -X PUT repos/LoistCloist/bug-bounty-marketplace/rulesets/24287837 --input .github/rulesets/main.json
```

CI does not deploy anything.

## Milestone scope

This repo is being built incrementally on `feat/m2-foundation` via small,
reviewed sub-branches (monorepo scaffold → shared schemas → web shell with
mocks → developer/auditor/arbiter flows → CI). See `CLAUDE.md` for the full
workflow and conventions.
