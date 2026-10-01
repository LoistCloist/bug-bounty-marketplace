# CLAUDE.md

Guidance for Claude Code (and human contributors) working in this repo.

## Project

AI-assisted smart contract security and bug-bounty marketplace. See
`README.md` for the full product description and finding-status lifecycle
(`Flagged → Submitted → Verified → Disputed/Rejected → Paid`).

## Commands

Most of these are stubs until the referenced branch lands — that's expected
at this stage of the milestone.

```sh
pnpm install              # install all workspace deps

pnpm -r lint               # fan out `lint` to every package that has it
pnpm -r typecheck          # fan out `typecheck`
pnpm -r test               # fan out `test`
pnpm -r build              # fan out `build`

pnpm --filter @bbm/api dev        # run the Fastify API with hot reload
pnpm --filter @bbm/api typecheck
pnpm --filter @bbm/api test
pnpm --filter @bbm/api build

pnpm --filter @bbm/shared typecheck

# Once apps/web exists (feat/web-shell-mocks):
NEXT_PUBLIC_API_MOCKING=enabled pnpm dev

# Contracts (requires Foundry, see contracts/README.md):
cd contracts && forge build && forge test
```

## Conventions

- **TypeScript strict mode everywhere.** All packages extend the root
  `tsconfig.base.json` (`strict: true`, `esModuleInterop`, `skipLibCheck`,
  `forceConsistentCasingInFileNames`, `target: ES2022`,
  `moduleResolution: bundler` by default — individual packages may override
  module resolution if their runtime requires it, e.g. `apps/api` uses
  `NodeNext`).
- **Conventional Commits** for every commit (`feat:`, `fix:`, `chore:`,
  `docs:`, `refactor:`, `test:`, etc.), small and scoped.
- **pnpm workspaces** cover `apps/*` and `packages/*` only. `workers/*` is
  deliberately excluded — it holds non-TypeScript services (Python/Rust) with
  their own toolchains, not pnpm packages.
- Run the relevant `lint` / `typecheck` / `test` / `build` for whatever you
  touched before every commit. It's fine if a package has nothing to run yet
  early in the milestone.

## Git workflow

- `feat/m2-foundation` is the integration branch for this milestone, cut from
  `main`.
- Each sub-branch (like this one, `chore/monorepo-scaffold`) is cut from the
  **latest** `feat/m2-foundation` — pull before cutting.
- Commit in small Conventional Commits. Lint/typecheck/test/build whatever
  you touched before each commit; only commit when it's green.
- Open a PR into `feat/m2-foundation` with `gh pr create`. Wait for CI, address
  reviewer findings.
- Before merging, **always run a fresh reviewer sub-agent on the PR diff**
  (not reused context) checking for: correctness and test coverage, schema
  consistency across packages, accidental real network calls (should be
  mocked), and scope creep beyond the sub-branch's stated purpose.
- Merge with `gh pr merge --merge --delete-branch` — a real merge commit, not
  a squash — so sub-branch history is preserved on `feat/m2-foundation`.
- Pull `feat/m2-foundation` before cutting the next sub-branch.
- When the whole milestone is done, open the final PR
  `feat/m2-foundation` → `main`, but **do not merge it** — it's left for
  team review.

## Sub-agent rules

- **Explore before big changes.** Read the relevant directories/files before
  scaffolding or refactoring anything non-trivial.
- **Foundation branches are sequential** (monorepo scaffold → shared schemas →
  web shell/mocks → CI), each depending on the last. Do them in order, one at
  a time.
- **Flow branches (developer / auditor / arbiter) run in parallel**, once the
  foundation is in place. Each flow gets its own git worktree and its own
  sub-agent, split by mock handler area:
  - `apps/web/mocks/handlers/{developer,auditor,arbiter}.ts` plus a shared
    `index.ts` that composes them.
  - The mock DB is split the same way (per-flow data/fixtures module).
  - Each flow agent may only touch files and routes under its own area. If a
    flow needs a change to shared code (shared schemas, the shared mock DB
    index, shared UI components), it **reports the need back** instead of
    editing shared files directly, so a human/coordinator can apply it once
    and avoid merge conflicts between the parallel worktrees.
- **Always run a fresh reviewer sub-agent on the PR diff before merging**
  (see Git workflow above) — this applies to every branch, foundation or
  flow.

## Adding a new Python service under `workers/`

1. Create `workers/<service-name>/` with its own `pyproject.toml` managed by
   `uv`.
2. Add a `Dockerfile` in that directory.
3. Add a path-filtered CI job that only triggers on changes under
   `workers/<service-name>/**` or `packages/shared/schema/**`.
4. Generate Python types from the JSON Schema files in
   `packages/shared/schema/*.json` using `datamodel-code-generator`, as part
   of that service's build step.

## Adding a new Rust service under `workers/`

1. Create `workers/<service-name>/` with its own `Cargo.toml`.
2. Add a `Dockerfile` in that directory.
3. Add a path-filtered CI job scoped to `workers/<service-name>/**` or
   `packages/shared/schema/**`, using `dtolnay/rust-toolchain` and
   `Swatinem/rust-cache`, running `cargo fmt --check`, `cargo clippy`, and
   `cargo test`.
4. Generate Rust types from `packages/shared/schema/*.json` using `typify`.
