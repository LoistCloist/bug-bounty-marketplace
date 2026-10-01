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

## Milestone scope

This repo is being built incrementally on `feat/m2-foundation` via small,
reviewed sub-branches (monorepo scaffold → shared schemas → web shell with
mocks → developer/auditor/arbiter flows → CI). See `CLAUDE.md` for the full
workflow and conventions.
