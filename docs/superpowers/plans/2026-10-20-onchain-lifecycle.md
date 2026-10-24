# On-chain Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The class demo runs Flagged → Submitted → Verified → (Disputed →) Paid/Rejected for real on a local Anvil chain, with users signing their own transactions in the browser.

**Architecture:** A compose overlay adds Anvil plus a deploy job and points the API at the deployment. The worker stops deciding finding status when a chain is configured; an API verdict loop calls Hein's `ChainActions.applyVerdict`, the event indexer (now started) moves statuses from contract events, and Hein's payout keeper pays. New session-authenticated routes confirm each user-signed transaction on-chain. The web app signs with viem local accounts (Anvil keys per role).

**Tech Stack:** Fastify + pg + viem (API), Python 3.12 + psycopg (worker), Next.js 16 + React 19 + viem (web), Foundry/Anvil, Docker Compose, Vitest, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-onchain-lifecycle-design.md`

**Starting point:** main at `3d8ed1a` (includes Hein's #39 chain actions + payout keeper, #42 stake gate, #43). Spec §5 step 1 (rebase #39/#42) is already done by Hein.

## Global Constraints

- Without `CHAIN_RPC_URL` (API) / `CHAIN_ENABLED` (worker) / `GET /api/chain` → `configured:false` (web), every existing behaviour and test stays unchanged.
- Anvil accounts: #0 `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (operator + arbiter, key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`), #1 `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` developer (key `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`), #2 `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` auditor (key `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`). Local chain id 31337 only.
- Demo values: `CHALLENGE_WINDOW=60`, `REFUND_DELAY=60`, `PAYOUT_KEEPER_INTERVAL_SECONDS=5`, indexer poll 5000 ms, verdict loop 2000 ms. Required stake 0.1 ETH (`REQUIRED_STAKE_WEI` already in `pipeline/routes.ts`).
- On-chain ids: `onchainId(apiId)` from `apps/api/src/chain/ids.ts` (keccak256 of the API id string). The web uses the same function (copied into `apps/web/src/lib/chain/ids.ts`).
- Money is wei decimal strings (`WeiSchema`); the UI shows ETH via `lib/money.ts`.
- Errors are JSON `{ error }` with 400/401/403/404/409, matching existing routes.
- Shared schema changes are additive only; regenerate `packages/shared/schema/*.json` (`pnpm --filter @bbm/shared gen:schema`) and the Python models (`uv run scripts/gen-types.sh`) when shared changes.
- Conventional Commits; lint/typecheck/test the touched package before each commit; one PR per section below into `main`; fresh reviewer sub-agent on each PR diff; never merge (teammates merge).

## Review Focus

1. Double application: the indexer and a route both apply the same status (e.g. Disputed) — the second must be a no-op, not a 409 or a duplicate history entry.
2. A user transaction that reverts or is rejected in the browser must not call the API route; a route called without the matching on-chain state must 409 and change nothing.
3. Session identity vs body identity: with a chain configured, a body `auditorId`/`developerAddress` that differs from the session must be ignored (or rejected), never trusted.
4. Restart safety: API restart mid-lifecycle (verdict applied on-chain but not marked; payout sent but not indexed) must converge without double sends.
5. Fresh stack: `pnpm stack:demo` twice in a row starts from an empty DB and a fresh chain, and the API picks up the new contract addresses.

Each line has a test in the owning task (marked **RF1–RF5**).

---

## PR A — Chain in the stack (branch `feat/chain-stack`)

### Task 1: Chain config from the deployments file, and `GET /api/chain`

**Files:**
- Modify: `apps/api/src/chain/config.ts`, `apps/api/src/app.ts`
- Create: `apps/api/src/chain/routes.ts`, `packages/shared/src/chain.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `apps/api/src/chain/chain.test.ts` (config), `apps/api/src/chain/routes.test.ts`, `packages/shared/src/__tests__/chain.test.ts`

**Interfaces:**
- Produces: `ChainConfig` gains `arbiterAddress: Address`, `challengeWindowSeconds: number`, `publicRpcUrl: string`. `loadChainConfig(env, readFile = fs.readFileSync)`: when `CHAIN_DEPLOYMENTS_FILE` is set, the three contract addresses, `arbiter` and `challengeWindow` come from that JSON (keys `auditorStaking`, `bountyEscrow`, `disputeResolution`, `arbiter`, `challengeWindow`); otherwise from env as today, with `ARBITER_ADDRESS` (default: the operator's address) and `CHALLENGE_WINDOW_SECONDS` (default 259200). `publicRpcUrl = PUBLIC_CHAIN_RPC_URL ?? rpcUrl`.
- Produces: shared `ChainInfoSchema = z.discriminatedUnion("configured", [{configured: false}, {configured: true, chainId, rpcUrl, addresses: {auditorStaking, bountyEscrow, disputeResolution}, arbiter: Address, challengeWindowSeconds: int, requiredStakeWei: Wei}])`, type `ChainInfo`.
- Produces: `registerChainRoutes(app, { config: ChainConfig | null })` → `GET /api/chain` returns `ChainInfo`. `AppOptions.chainConfig?: ChainConfig | null`.

- [ ] **Step 1: Failing tests.** In `chain.test.ts`: `loadChainConfig({CHAIN_RPC_URL, CHAIN_ID:"31337", OPERATOR_PRIVATE_KEY:<#0 key>, CHAIN_DEPLOYMENTS_FILE:"/d.json"}, () => JSON.stringify({auditorStaking:A, bountyEscrow:B, disputeResolution:C, arbiter:D, challengeWindow:60}))` returns those addresses, `arbiterAddress: D`, `challengeWindowSeconds: 60`; a file missing `bountyEscrow` throws `/bountyEscrow/`; without the file, `arbiterAddress` equals `privateKeyToAccount(key).address`. In `routes.test.ts`: `GET /api/chain` with `chainConfig: null` → `200 {configured:false}`; with a config → `configured:true`, `requiredStakeWei:"100000000000000000"`, `rpcUrl` = `publicRpcUrl`. Shared test: both variants parse; `configured:true` without `addresses` fails.
- [ ] **Step 2:** `pnpm --filter @bbm/api test -- chain` and `pnpm --filter @bbm/shared test` → FAIL (missing exports).
- [ ] **Step 3:** Implement as in Interfaces; wire `registerChainRoutes` in `buildApp`; `index.ts` passes `chainConfig`. Regenerate shared JSON schema and Python models.
- [ ] **Step 4:** Same commands → PASS; `pnpm -r typecheck`.
- [ ] **Step 5:** Commit `feat(api): read chain config from the deployments file and serve GET /api/chain`.

### Task 2: Compose overlay, demo deploy values, `pnpm stack:demo`

**Files:**
- Create: `docker-compose.chain.yml`, `scripts/demo-stack.sh`
- Modify: `docker-compose.yml` (`contracts-deploy` passes `CHALLENGE_WINDOW`, `REFUND_DELAY` through), `package.json` (`"stack:demo": "bash scripts/demo-stack.sh"`), `README.md` ("Running the full lifecycle demo")

**Interfaces:**
- Produces: overlay sets on `api`: `CHAIN_RPC_URL=http://anvil:8545`, `PUBLIC_CHAIN_RPC_URL=http://localhost:8545`, `CHAIN_ID=31337`, `OPERATOR_PRIVATE_KEY=<#0>`, `CHAIN_DEPLOYMENTS_FILE=/deployments/31337.json`, `CLAIM_LOCK_ENABLED=true`, `PAYOUT_KEEPER_INTERVAL_SECONDS=5`, `INDEXER_POLL_MS=5000`, `VERDICT_INTERVAL_MS=2000`, `SESSION_SECRET=demo-session-secret`, volume `deployments:/deployments:ro`, `depends_on: anvil`; on `analysis`: `CHAIN_ENABLED=true`; on `contracts-deploy`: `CHALLENGE_WINDOW=60`, `REFUND_DELAY=60`; `anvil` publishes `8545:8545`.
- Produces: `scripts/demo-stack.sh`: `docker compose -f docker-compose.yml -f docker-compose.sandbox.yml -f docker-compose.chain.yml` with `down -v`; build `bbm-sandbox:latest` if `docker image inspect` fails; `up -d --build --wait db anvil`; `run --rm contracts-deploy`; `up -d --build --wait api analysis`; print the deployment JSON and `curl -s localhost:3001/api/chain`. Exits non-zero on any failure (`set -euo pipefail`). Requires `DOCKER_GID` (computed with `stat -c %g /var/run/docker.sock` if unset).

- [ ] **Step 1:** Write the overlay and script.
- [ ] **Step 2: Verify (RF5).** Run `pnpm stack:demo` twice. Expected both times: script exits 0, `/api/chain` shows `configured:true` with the addresses printed from `31337.json`, and `psql … -c "select count(*) from contracts"` → 0.
- [ ] **Step 3:** `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.3` unaffected; `bash -n scripts/demo-stack.sh`.
- [ ] **Step 4:** Commit `feat: chain compose overlay and pnpm stack:demo`. Open PR A.

---

## PR B — Verdict hand-off and status sync (branch `feat/verdict-handoff`, from main after PR A)

### Task 3: Worker leaves the finding Submitted when `CHAIN_ENABLED`

**Files:**
- Modify: `workers/analysis/src/analysis/config.py` (`chain_enabled: bool` from `CHAIN_ENABLED`, same truthy parsing as `SANDBOX_ENABLED`), `workers/analysis/src/analysis/sandbox_job.py`
- Test: `workers/analysis/tests/test_sandbox_job.py`, `tests/test_config.py`

- [ ] **Step 1: Failing tests.** `test_chain_enabled_records_result_only`: with `chain_enabled=True` and a runner returning Passed, after `run_sandbox_job` the PoC row has `sandbox_status='Passed'`, the finding is still `Submitted` with unchanged `status_history` and `challenge_window_expires_at IS NULL`, the job is `done`. Same for Failed. Existing tests (chain disabled) keep asserting Verified/Rejected. Config test: `CHAIN_ENABLED=true` → `chain_enabled is True`, unset → False.
- [ ] **Step 2:** `cd workers/analysis && uv run pytest tests/test_sandbox_job.py tests/test_config.py -q` → FAIL.
- [ ] **Step 3:** In `run_sandbox_job`, skip the `UPDATE findings` when `settings.chain_enabled`.
- [ ] **Step 4:** `uv run pytest -q && uv run ruff check . && uv run ruff format --check .` → PASS.
- [ ] **Step 5:** Commit `feat(analysis): leave verdicts to the API when a chain is configured`.

### Task 4: Status writes are transition-guarded; Verified sets the window; Paid resolves the contract

**Files:**
- Create: `apps/api/src/db/migrations/0007_lifecycle.sql`
- Modify: `apps/api/src/chain/pg-action-store.ts`, `apps/api/src/chain/memory-action-store.ts`, `apps/api/src/chain/action-store.ts`
- Test: `apps/api/src/chain/actions.test.ts` (memory), `apps/api/src/testing/repository-suite.ts` or a new `apps/api/src/chain/pg-action-store.test.ts` (pg, runs with `DATABASE_URL`)

**Interfaces:**
- Produces migration 0007: `ALTER TABLE poc_submissions ADD COLUMN verdict_applied_at TIMESTAMPTZ`; `CREATE TABLE disputes (id TEXT PRIMARY KEY, finding_id TEXT NOT NULL UNIQUE REFERENCES findings(id), contract_id TEXT NOT NULL REFERENCES contracts(id), developer_id TEXT NOT NULL, reason TEXT NOT NULL, opened_at TIMESTAMPTZ NOT NULL, challenge_window_expires_at TIMESTAMPTZ, ruling TEXT NOT NULL DEFAULT 'Pending' CHECK (ruling IN ('Pending','ForAuditor','AgainstAuditor')), ruled_at TIMESTAMPTZ, arbiter_id TEXT)`; `ALTER TABLE bounties` is unchanged (`funded_at` exists).
- Produces: `ChainActionStore` option `challengeWindowSeconds: number` (constructor arg of both stores). `setFindingStatus(findingId, status, changedAt)` now: (a) updates only `WHERE id=$1 AND status = ANY($predecessors)` where `$predecessors` is every status `s` with `canTransitionFinding(s, status)`; zero rows and current status already equal → no-op (RF1); zero rows otherwise → throw `InvalidTransitionError`; (b) when `status = 'Verified'` also sets `challenge_window_expires_at = changedAt + challengeWindowSeconds`; (c) when `status = 'Paid'` also sets the finding's contract `status='Resolved'` in the same transaction.

- [ ] **Step 1: Failing tests** (memory and pg): `Verified sets the challenge window` (expiresAt = changedAt + 60 s); `Paid resolves the contract`; `same status twice is a no-op` (history length 1 after two `Disputed` writes — RF1); `illegal move throws InvalidTransitionError` (Paid → Disputed).
- [ ] **Step 2:** `pnpm --filter @bbm/api test -- action-store` (and with `DATABASE_URL` for pg) → FAIL.
- [ ] **Step 3:** Implement; `index.ts` passes `chainConfig.challengeWindowSeconds`.
- [ ] **Step 4:** Full `pnpm --filter @bbm/api test` and with `DATABASE_URL=postgres://bbm:bbm@localhost:5432/bbm_test` → PASS.
- [ ] **Step 5:** Commit `feat(api): guard status writes by transition, set the challenge window, resolve on payout`.

### Task 5: Verdict loop

**Files:**
- Create: `apps/api/src/chain/verdict-loop.ts`
- Modify: `apps/api/src/pipeline/repository.ts`, `pg-repository.ts`, `memory-repository.ts`, `apps/api/src/index.ts`
- Test: `apps/api/src/chain/verdict-loop.test.ts`

**Interfaces:**
- Consumes: `ChainActions.applyVerdict(findingId, "Passed"|"Failed"): Promise<FindingStatus>`.
- Produces: `PipelineRepository.listUnappliedVerdicts(limit: number): Promise<{ pocId: string; findingId: string; verdict: "Passed"|"Failed" }[]>` (PoCs with `sandbox_status IN ('Passed','Failed')`, `verdict_applied_at IS NULL`, finding `status = 'Submitted'`, oldest first) and `markVerdictApplied(pocId: string, at: Date): Promise<void>`.
- Produces: `runVerdictsOnce(deps: { pipeline: PipelineRepository; chainActions: ChainActions; now?: () => Date; onError?: (msg: string, err: unknown) => void }): Promise<{ applied: number; failed: number }>` and `startVerdictLoop({ runOnce, intervalMs }): { stop(): Promise<void> }` (non-overlapping ticks, unref'd timer — same shape as `startPayoutKeeper`).

- [ ] **Step 1: Failing tests.** `applies Passed through chain actions and marks it applied`; `a failing applyVerdict leaves the PoC unmarked and continues with the next` (failed:1, applied:1); `already-applied verdicts are not listed again`; **RF4** `a verdict applied on-chain but not marked converges`: first `applyVerdict` succeeds then `markVerdictApplied` throws; the second run calls `applyVerdict` again and the fake chain records exactly one `recordVerification` (relies on #39's read-before-write).
- [ ] **Step 2:** `pnpm --filter @bbm/api test -- verdict-loop` → FAIL.
- [ ] **Step 3:** Implement; start in `index.ts` after listen when `chainActions` exists, interval `VERDICT_INTERVAL_MS` (default 2000); stop on shutdown before the pool closes.
- [ ] **Step 4:** API tests PASS (memory and pg).
- [ ] **Step 5:** Commit `feat(api): apply sandbox verdicts through chain actions`.

### Task 6: Start the event indexer

**Files:**
- Modify: `apps/api/src/index.ts`, `apps/api/src/indexer/indexer.ts` (no behaviour change; export what `index.ts` needs)
- Test: `apps/api/src/indexer/indexer.test.ts` (one test for the store wiring)

**Interfaces:**
- Consumes: `startEventIndexer({ config, repository: new PgIndexerRepository(pool), findingStatus: new PgChainActionStore(pool, …), listFindingIds, lock: new PgIndexerLock(pool), pollIntervalMs: INDEXER_POLL_MS ?? 5000 })`.
- Produces: `listFindingIds(pool): Promise<string[]>` in `apps/api/src/indexer/pg-repository.ts` (`SELECT id FROM findings`). On `Unfrozen(auditorWon)` the indexer also calls `chainActions.applyDisputeResolved(findingId)` — add an optional `onStatusApplied?(findingId, status, eventName)` to `StartEventIndexerOptions`, called after a successful apply.

- [ ] **Step 1: Failing test.** `calls onStatusApplied after an Unfrozen event is applied` with the memory repository and a fake client emitting `Frozen` then `Unfrozen(auditorWon=true)`: finding ends `Verified` (window reset per Task 4), hook called with `("Verified","Unfrozen")`.
- [ ] **Step 2:** `pnpm --filter @bbm/api test -- indexer` → FAIL.
- [ ] **Step 3:** Implement the hook; wire the indexer in `index.ts` (start after listen, stop on shutdown).
- [ ] **Step 4:** API tests PASS. **Verify on the stack:** `pnpm stack:demo`, run `scripts/demo-pipeline.sh` with the auditor = Anvil #2 after `cast send --value 0.1ether <staking> "stake()" --private-key <#2>` and funding via `cast send --value 1ether <escrow> "fund(bytes32,uint256)" …`; expect the reentrancy finding `Verified` with `challengeWindowExpiresAt` set, then `Paid` within ~70 s.
- [ ] **Step 5:** Commit `feat(api): start the event indexer`. Open PR B.

---

## PR C — Sign-in and lifecycle routes (branch `feat/lifecycle-routes`, from main after PR B)

### Task 7: Signed-message sign-in

**Files:**
- Create: `apps/api/src/auth/session.ts`, `apps/api/src/auth/routes.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/package.json` (`@fastify/cookie`)
- Test: `apps/api/src/auth/auth.test.ts`

**Interfaces:**
- Produces: `registerAuthRoutes(app, { secret: string; now?: () => Date })`: `POST /api/auth/nonce {address}` → `{ nonce, message }` with message exactly `BountyGuard sign-in\nAddress: ${address}\nNonce: ${nonce}`, nonce valid 5 minutes, single use; `POST /api/auth/login {address, signature}` → verifies with viem `verifyMessage`, sets cookie `bbm_session` (`httpOnly`, `sameSite: "lax"`, path `/`, value `base64url(address|expiryMs).hmac`), 8-hour expiry, returns `{address}`; `GET /api/auth/me` → `{address}` or 401; `POST /api/auth/logout` clears it.
- Produces: `sessionAddress(request): Address | null` and `requireSession(request, reply): Address | undefined` (sends 401 `{error:"sign in first"}` and returns undefined).
- `AppOptions.sessionSecret?: string` (from `SESSION_SECRET`; when a chain is configured and it is unset, startup throws).

- [ ] **Step 1: Failing tests:** login with a signature from `privateKeyToAccount(#2)` sets the cookie and `/me` returns #2; wrong signer → 401; reused nonce → 401; expired nonce (now + 6 min) → 401; tampered cookie → 401.
- [ ] **Step 2:** `pnpm --filter @bbm/api test -- auth` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; typecheck.
- [ ] **Step 5:** Commit `feat(api): signed-message sign-in with a session cookie`.

### Task 8: Session identity on claim and PoC; funded, queue, cancel, reclaim

**Files:**
- Create: `apps/api/src/contracts/lifecycle-routes.ts`
- Modify: `apps/api/src/pipeline/routes.ts` (claim, poc), `apps/api/src/contracts/repository.ts` + pg/memory (`markFunded`, `setStatus`), `apps/api/src/chain/bounty-escrow.ts` (`OnchainBounty` gains `developer: Address`, `amount: bigint`, `deadline: bigint`; add `BOUNTY_STATE_OPEN = 1`, `BOUNTY_STATE_CLOSED = 3`), `apps/api/src/app.ts`
- Test: `apps/api/src/contracts/lifecycle-routes.test.ts`, `apps/api/src/pipeline/routes.test.ts`

**Interfaces:**
- Produces: `ContractRepository.markFunded(contractId: string, at: Date): Promise<void>`, `setContractStatus(contractId: string, next: ContractStatus): Promise<Contract>` (uses `transitionContract`), and `listQueue` gains `{ fundedOnly: boolean }`.
- Produces routes (all `requireSession` when a chain is configured):
  - `POST /api/contracts/:id/funded` → session must equal `contract.developerAddress` (403); `readBounty(onchainId(id))` must be state Open, developer = session, amount = bounty amount (wei), deadline = contract deadline in unix seconds (409 `{error:"bounty not funded on-chain"}`); sets `funded_at`; returns the `Contract`. Idempotent.
  - `GET /api/auditor/queue` → `fundedOnly` when a chain is configured.
  - `POST /api/contracts/:id/cancel` → developer only; chain state must be Closed with `submissionCount = 0`; contract → `Expired`.
  - `POST /api/contracts/:id/reclaim` → developer only; chain state Closed; contract → `Expired`.
  - Claim/PoC: auditor = session address when a chain is configured; a differing body `auditorId` → 403 (**RF3**).

- [ ] **Step 1: Failing tests** with fake ports: funded happy path; funded by a non-developer → 403; funded with chain state None → 409 and `funded_at` stays null (**RF2**); funded twice → 200 both; queue hides unfunded contracts when chain configured, shows all when not; cancel with chain Open → 409; reclaim happy path → `Expired`; claim with body `auditorId` ≠ session → 403; no session → 401.
- [ ] **Step 2:** `pnpm --filter @bbm/api test -- lifecycle-routes routes` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS (memory and pg).
- [ ] **Step 5:** Commit `feat(api): session identity and funded, cancel and reclaim routes`.

### Task 9: Profile, false positive, disputes and rulings

**Files:**
- Create: `apps/api/src/disputes/repository.ts`, `pg-repository.ts`, `memory-repository.ts`, `routes.ts`
- Modify: `apps/api/src/chain/auditor-staking.ts` (add `reputation(auditor): Promise<bigint>`), `packages/shared/src/auditor-profile.ts` (`pendingPayout: WeiSchema.optional()`), `apps/api/src/pipeline/routes.ts` (false positive), `apps/api/src/app.ts`
- Test: `apps/api/src/disputes/routes.test.ts`, `apps/api/src/pipeline/routes.test.ts`

**Interfaces:**
- Produces: `DisputeRepository { create(d: Dispute): Promise<Dispute>; findByFinding(findingId): Promise<Dispute|null>; findById(id): Promise<Dispute|null>; list(ruling?: DisputeRuling): Promise<Dispute[]>; setRuling(id, ruling, arbiterId, at): Promise<Dispute> }`.
- Produces routes:
  - `GET /api/auditor/profile` → `AuditorProfile` for the session address: `stake = stakeOf`, `reputation = Number(reputation)`, `claimedContractIds` from the DB, `pendingPayout = pendingPayouts`. Without a chain: today's 404 behaviour is unchanged (route not registered).
  - `POST /api/findings/:id/false-positive` → session must hold the claim on the finding's contract (403); finding must be `Flagged` (409); → `Rejected`, `is_false_positive = true`; returns `Finding`.
  - `POST /api/findings/:id/dispute {reason}` → session must be the developer (403); `getDispute(onchainId(contractId), onchainId(findingId))` must exist and be unresolved (409); creates the dispute (or returns the existing one for the finding — idempotent, **RF1**) with `challengeWindowExpiresAt` from the finding; applies `Disputed` through the guarded status write; returns 201 `Dispute`.
  - `GET /api/arbiter/disputes[?ruling=]` → session must equal `config.arbiterAddress` (403); returns disputes with `finding` and `pocSubmission`, the shape `ArbiterDisputeViewSchema` in the web expects.
  - `POST /api/arbiter/disputes/:id/rule {ruling}` → arbiter only; on-chain dispute must be `resolved` (409 otherwise); `readBounty` decides the outcome: `verifiedFinding == onchainId(findingId)` ⇒ auditor won ⇒ `ruling` must be `ForAuditor`, else must be `AgainstAuditor` (409 on mismatch); already ruled → 409; sets ruling; finding → `Verified` (new window) or `Rejected`; calls `chainActions.applyDisputeResolved(findingId)`.

- [ ] **Step 1: Failing tests:** profile reads stake/reputation/pending from the fake port; false positive by a non-claimant → 403, on `Submitted` → 409, happy path → `Rejected`; dispute without on-chain dispute → 409 (**RF2**), happy → 201 + finding `Disputed`, replay → 201 same id and one history entry; arbiter list by developer → 403; rule before on-chain resolution → 409; rule `ForAuditor` when escrow says lost → 409; rule happy paths both ways; second rule → 409.
- [ ] **Step 2:** `pnpm --filter @bbm/api test -- disputes routes` → FAIL.
- [ ] **Step 3:** Implement; regenerate shared schema + Python models.
- [ ] **Step 4:** `pnpm -r test`, `pnpm -r typecheck`, with and without `DATABASE_URL` → PASS.
- [ ] **Step 5:** Commit `feat(api): profile, false positive, dispute and ruling routes`. Open PR C.

---

## PR D — Web: wallet, chain calls, live wiring (branch `feat/web-onchain`, from main after PR C; Joshua reviews)

### Task 10: Chain client and local-account wallet

**Files:**
- Modify: `apps/web/package.json` (`viem` — same version as `apps/api`)
- Create: `apps/web/src/lib/chain/config.ts`, `ids.ts`, `accounts.ts`, `calls.ts`; `apps/web/src/lib/api/auth.ts`, `apps/web/src/lib/api/chain.ts`
- Modify: `apps/web/src/lib/wallet/index.ts`, create `apps/web/src/lib/wallet/local.ts`
- Test: `apps/web/src/lib/chain/__tests__/calls.test.ts`, `apps/web/src/lib/wallet/__tests__/local.test.ts`

**Interfaces:**
- Produces: `useChainInfo(): ChainInfo | undefined` (react-query on `GET /api/chain`, `staleTime: Infinity`).
- Produces: `ANVIL_ACCOUNTS: Record<Role, { address: Address; privateKey: Hex }>` (Global Constraints values).
- Produces: `chainCalls(info, role)` returning `{ fundBounty(contractId, deadline: Date, amountWei: string), stake(amountWei), openDispute(contractId, findingId, reason), rule(contractId, findingId, auditorWon: boolean), deleteBounty(contractId), refund(contractId), withdrawPayout() }`, each `Promise<Hash>` that resolves after a successful receipt and throws `ChainTxError(message)` carrying the revert reason otherwise.
- Produces: `signIn(role): Promise<Address>` (`POST /api/auth/nonce` → `account.signMessage` → `POST /api/auth/login`).
- `useWallet()`: when `useChainInfo()?.configured && chainId === 31337`, returns the local wallet (address from `ANVIL_ACCOUNTS[role]`, `connect()` = `signIn(role)`); otherwise the mock, unchanged.

- [ ] **Step 1: Failing tests** with a mocked viem transport: `fundBounty` sends `fund(onchainId(id), deadlineSeconds)` with `value`; a reverted receipt throws `ChainTxError` with the reason; `useWallet` returns the mock when `configured:false` and Anvil #1 for developer when configured.
- [ ] **Step 2:** `pnpm --filter @bbm/web test -- chain wallet` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; `pnpm --filter @bbm/web lint typecheck`.
- [ ] **Step 5:** Commit `feat(web): viem chain calls and local Anvil wallet`.

### Task 11: Flows call the chain, then the API

**Files:**
- Modify: `apps/web/src/app/submit/page.tsx` (fund after upload, then `POST …/funded`), `apps/web/src/app/auditor/_components/StakeGate.tsx` (stake on-chain, then refetch profile; required stake from `requiredStakeWei`), `apps/web/src/app/contracts/_components/FindingCard.tsx` (dispute), `apps/web/src/app/arbiter/_components/DisputeCard.tsx` (rule), `apps/web/src/app/contracts/[id]/page.tsx` (cancel → `deleteBounty`, reclaim → `refund`), `apps/web/src/app/auditor/_components/ProfileSummary.tsx` (pending payout + Withdraw button), `apps/web/src/app/auditor/page.tsx` and `apps/web/src/app/auditor/contracts/[id]/page.tsx` (auditor id = wallet address; drop `SEED_AUDITOR_ID` imports), `apps/web/src/lib/api/{developer,auditor,arbiter}.ts` (`markFunded`, profile without `auditorId` when signed in)
- Test: component tests next to each file

- [ ] **Step 1: Failing tests** per flow (chain calls mocked): success calls the chain helper then the API helper in that order; a `ChainTxError` shows its message and calls no API helper (**RF2**); mock mode (`configured:false`) keeps today's behaviour (existing tests stay green).
- [ ] **Step 2:** `pnpm --filter @bbm/web test` → new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm --filter @bbm/web test lint typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(web): sign lifecycle transactions in the browser`.

### Task 12: Live routes and accurate copy

**Files:**
- Modify: `apps/web/src/mocks/handlers/live.ts` (add every route from Tasks 7–9 plus `GET /api/chain`), `apps/web/src/components/Header.tsx` (banner), `apps/web/src/app/submit/page.tsx` (What happens next), `apps/web/src/app/guide/page.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/app/contracts/page.tsx`, `apps/web/src/app/auditor/_components/FindingCard.tsx`
- Test: `apps/web/src/mocks/handlers/live.test.ts`, `apps/web/src/components/__tests__/Header.test.tsx`

**Copy (exact):** banner when chain configured: "Local test chain · Transactions are real on a local Anvil network; no real funds." What happens next: "01 Automated analysis — Slither findings appear in under a minute, with plain-English explanations." "02 Independent review — An auditor stakes 0.1 ETH, claims the contract and submits a Foundry proof of concept." "03 Verified resolution — A reproduced exploit opens a 60-second challenge window, then the bounty is paid on-chain." Mock mode keeps today's copy.

- [ ] **Step 1: Failing tests:** live mode drops the MSW handlers for all new routes; Header shows the chain banner when `configured:true` and the demo banner otherwise.
- [ ] **Step 2–4:** FAIL → implement → PASS (`pnpm --filter @bbm/web test lint typecheck build`).
- [ ] **Step 5:** Commit `feat(web): route lifecycle calls to the API and describe the real chain`. Open PR D.

---

## PR E — Demo and end-to-end (branch `test/lifecycle-e2e`, from main after PR D)

### Task 13: Full-lifecycle demo script

**Files:**
- Create: `scripts/demo-lifecycle.sh`
- Modify: `README.md`

**Interfaces:** uses `cast` from the `contracts` image (`docker compose run --rm --entrypoint cast contracts-deploy …`) for user transactions and `curl` with a cookie jar for API calls; signs in by `cast wallet sign`. Two scenarios: **payout** (fund → analysis → stake → claim → passing PoC → Verified → wait 65 s → Paid → `withdrawPayout` → auditor balance up by 1 ETH) and **dispute** (second contract, Verified → developer `openDispute` + API dispute → arbiter `rule(false)` + API rule → Rejected, auditor stake halved). Prints `LIFECYCLE OK`.

- [ ] **Step 1:** Write the script.
- [ ] **Step 2: Verify:** `pnpm stack:demo && ./scripts/demo-lifecycle.sh` → `LIFECYCLE OK`; rerun `pnpm stack:demo && ./scripts/demo-lifecycle.sh` → `LIFECYCLE OK` (RF5).
- [ ] **Step 3:** Commit `test: full lifecycle demo script`.

### Task 14: Playwright end-to-end on the chain stack

**Files:**
- Create: `tests/e2e/lifecycle.spec.ts`
- Modify: `tests/e2e/playwright.config.ts` (project `lifecycle`, only when `E2E_CHAIN=1`), `.github/workflows/ci.yml` only if the job fits the existing e2e tier's time budget; otherwise documented as a manual tier in `tests/README.md`

- [ ] **Step 1:** Test: developer uploads `Vault.sol` and funds 1 ETH; waits for the reentrancy finding; switches to Auditor, stakes 0.1 ETH, claims, uploads `PoC_pass.t.sol`; sees `Verified`, then `Paid` within 90 s; withdraws.
- [ ] **Step 2:** `E2E_CHAIN=1 pnpm test:e2e -- --project lifecycle` against `pnpm stack:demo` + `pnpm --filter @bbm/web dev` with live flags → PASS.
- [ ] **Step 3:** Commit `test(e2e): full lifecycle in the browser`. Open PR E.

### Task 15: Docs and deliverables (no PR)

- [ ] Update the Milestone 3 doc (§1 statuses, §3 tests, §4 known issues, §5 demo using `pnpm stack:demo`) and the deck (features table, demo steps, known issues, next steps) to match what PR A–E delivered, verified by re-rendering both.
