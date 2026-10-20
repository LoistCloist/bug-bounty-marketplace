# On-chain lifecycle design (Milestone 3 MVP completion)

- **Owner:** James Leung, coordinating with Hein Zarni Aung (chain), Joshua Basil (web) and Pranav Jothivel (stack)
- **Date:** 2026-10-20
- **Due:** Milestone 3 MVP, 2026-10-24
- **Requirements covered:** R1 (funded bounty), R7 (all six statuses), R8, R9, R10, R11 (refund), R21, "user authentication"

## 1. Goal

The class demo runs the whole finding lifecycle for real, against a local
Anvil chain, from the web app:

1. A developer uploads a contract and funds its bounty into `BountyEscrow`.
2. Slither and Grok flag findings (already live).
3. An auditor stakes into `AuditorStaking`, claims the contract and submits a
   PoC (claim and PoC already live).
4. The sandbox passes the PoC. The API records the verification on-chain and
   the finding becomes `Verified` with a challenge window.
5. Either the window closes and the payout keeper pays the auditor (`Paid`),
   who withdraws the ETH, or the developer disputes (`Disputed`) and the
   arbiter rules for the auditor (back to `Verified`, then `Paid`) or against
   (`Rejected`, stake slashed).

Users sign their own transactions. The API signs only operator actions.

## 2. Current state (2026-10-20, main at 87121e0)

- Contracts are complete (101 Foundry tests). Roles: operator signs
  `recordSubmission`, `recordVerification`, `payout`, `lock/unlockSubmission`;
  the developer signs `fund`, `deleteBounty`, `refund`, `openDispute`; the
  auditor signs `stake`, `withdraw`, `withdrawPayout`; the arbiter signs `rule`.
  The deploy script makes the deployer both operator and arbiter.
- `docker-compose.yml` has `anvil` and a one-shot `contracts-deploy` that
  writes `deployments/31337.json`, but the API gets no chain configuration.
- The API's only chain write is the claim lock (off by default). The event
  indexer exists but is never started. No route handles stake, profile,
  disputes, rulings, false positives, cancel or reclaim.
- Hein's open PRs: #39 (`createChainActions`: `applyVerdict`,
  `applyDisputeResolved`, payout keeper; no callers) and #42 (stake gate on PoC
  intake, `recordVerdict`). Both conflict with main.
- The analysis worker writes `Verified`/`Rejected` straight to `findings`;
  nothing sets `challenge_window_expires_at` except that write.
- The web wallet is a mock with fixed addresses; the auditor id is
  hard-coded `auditor_1`; there is no wagmi or viem in `apps/web`.

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Users sign in the browser with viem, using Anvil's well-known dev accounts: #0 arbiter (also operator), #1 developer, #2 auditor. The role switcher selects the account. | Users really sign and the API never holds their keys, with no browser extension needed in class. A MetaMask connector can replace the local account later behind the same wallet interface. |
| D2 | Signed-message sign-in: the browser signs a login message containing a server nonce; the API verifies it with viem `verifyMessage` and sets an HMAC-signed session cookie holding the address. | Removes trust in body-supplied identities; covers "user authentication". |
| D3 | The worker stops deciding finding status when a chain is configured. It writes only `poc_submissions.sandbox_status`. An API verdict loop applies results through Hein's `applyVerdict`. | Keeps the Python worker chain-free and keeps one owner (the API) for status moves that need chain calls. Without a chain the worker keeps today's behaviour. |
| D4 | Chain-driven statuses (`Verified`, `Disputed`, `Paid`, post-ruling) come from the event indexer; user-transaction routes also confirm on-chain state and apply the same status idempotently, so the UI updates without waiting a poll. | One mapping of events to statuses (Hein's indexer); routes and indexer agree because a same-status write is a no-op and every write is a conditional update. |
| D5 | Demo deploy uses `CHALLENGE_WINDOW=60` seconds and a 5-second keeper and indexer interval. | A payout happens within a class demo. |
| D6 | I rebase #39 and #42 onto main and push to Hein's branches (after Hein is told), then build on them. | They are the verdict and stake-gate halves of this design; rebuilding them would duplicate his work. |

## 4. Design

### 4.1 Chain in the stack

- New compose overlay `docker-compose.chain.yml`: the `api` service gets
  `CHAIN_RPC_URL=http://anvil:8545`, `CHAIN_ID=31337`, `OPERATOR_PRIVATE_KEY`
  (Anvil #0), `CLAIM_LOCK_ENABLED=true`, and mounts the `deployments` volume
  read-only. The analysis service gets `CHAIN_ENABLED=true` (D3).
- `loadChainConfig` gains `CHAIN_DEPLOYMENTS_FILE`: when set, the three
  addresses come from that JSON (`auditorStaking`, `bountyEscrow`,
  `disputeResolution`) instead of individual env vars.
- `contracts-deploy` accepts `CHALLENGE_WINDOW` and `REFUND_DELAY` from the
  overlay (60 and 60 seconds for the demo).
- New route `GET /api/chain` returns `{ configured, chainId, rpcUrl,
  addresses, challengeWindowSeconds, requiredStakeWei }` (`rpcUrl` is the
  browser-reachable URL, `PUBLIC_CHAIN_RPC_URL`, default
  `http://localhost:8545`). Without a chain: `{ configured: false }`.
- `scripts/demo-stack.sh` (`pnpm stack:demo`): `down -v`, build the sandbox
  image if missing, start db, anvil, api, analysis with both overlays, run
  `contracts-deploy`, restart the API so it reads the deployment, wait for
  health.

### 4.2 Verdict hand-off and status sync

- Worker (`sandbox_job.py`): when `CHAIN_ENABLED` is set, write only
  `sandbox_status`/`sandbox_log` and complete the job; leave the finding
  `Submitted`. Otherwise unchanged.
- API `startVerdictLoop` (new, `apps/api/src/chain/verdict-loop.ts`): every
  `VERDICT_INTERVAL_MS` (default 2000) selects PoCs with a decided
  `sandbox_status` whose finding is still `Submitted` and not yet applied, and
  calls `chainActions.applyVerdict(findingId, verdict)`. Marks
  `poc_submissions.verdict_applied_at` on success; leaves it for retry on
  failure (logged). Started only when chain and database are configured.
- Indexer: started in `index.ts` with the Postgres repository and lock. On
  `FindingVerified` (and `Unfrozen` with `auditorWon`) it also sets
  `challenge_window_expires_at = verifiedAt + challengeWindow` (window read
  once from the escrow). On `Funded` it sets `bounties.funded_at`. On
  `PayoutCredited` → `Paid` and the contract → `Resolved`.
- Postgres finding-status writes use `UPDATE … WHERE id = $1 AND status =
  $current` and append to `status_history`. (#39's Postgres action store is
  reused if it already implements this; otherwise it is added there.)
- Payout keeper from #39 runs every `PAYOUT_KEEPER_INTERVAL_SECONDS` (demo 5).

### 4.3 Sign-in

- `POST /api/auth/nonce` → `{ nonce, message }` (nonce stored in memory for
  5 minutes; message `BountyGuard sign-in\nAddress: <addr>\nNonce: <nonce>`).
- `POST /api/auth/login { address, signature }` → verifies, sets cookie
  `bbm_session` (address + expiry, HMAC with `SESSION_SECRET`), returns
  `{ address }`. `POST /api/auth/logout` clears it. `GET /api/auth/me`.
- When a chain is configured, routes that act for a user take the address
  from the session (401 without one) and ignore body identities. Without a
  chain, existing behaviour stays (mock mode and current tests).

### 4.4 New and changed API routes

All take identity from the session (§4.3). "Confirms" means the API reads the
contract state with the operator client and returns 409 if it does not match.

| Route | Who | Effect |
|---|---|---|
| `POST /api/contracts/:id/funded` | developer of the contract | Confirms `bounties(onchainId)` is Open, developer and amount match; sets `funded_at`. |
| `GET /api/auditor/queue` | anyone | With a chain, lists only funded contracts. |
| `GET /api/auditor/profile` | session auditor | `{ id: address, address, stake: stakeOf, reputation, claimedContractIds, pendingPayout }` from chain + DB. |
| `POST /api/findings/:id/false-positive` | auditor holding the claim | `Flagged → Rejected`, `is_false_positive = true`. No chain call. |
| `POST /api/findings/:id/dispute { reason }` | developer of the contract | Confirms the dispute exists on-chain (`getDispute`); inserts a `disputes` row (Pending); finding → `Disputed`. |
| `GET /api/arbiter/disputes[?ruling=]` | arbiter (session = deployment's arbiter) | Disputes with finding and PoC, as the web expects today. |
| `POST /api/arbiter/disputes/:id/rule { ruling }` | arbiter | Confirms the on-chain dispute is resolved and that the escrow outcome matches `ruling`; sets ruling, `ruled_at`, `arbiter_id`; finding → `Verified` (new window) or `Rejected`; calls `applyDisputeResolved`. 409 if already ruled. |
| `POST /api/contracts/:id/cancel` | developer | Confirms the bounty was deleted (state Closed); contract → `Expired`. |
| `POST /api/contracts/:id/reclaim` | developer | Confirms the refund (state Closed); contract → `Expired`. |
| `POST /api/auditor/claim`, `POST /api/auditor/poc` | session auditor | Unchanged, except identity from the session and #42's stake gate. |

New migration: `disputes (id, finding_id unique, contract_id, developer_id,
reason, opened_at, challenge_window_expires_at, ruling, ruled_at,
arbiter_id)`, `poc_submissions.verdict_applied_at`.

Response shapes reuse the shared schemas (`DisputeSchema`,
`AuditorProfileSchema`, `FindingSchema`, `ContractSchema`). Additive shared
changes only: `ChainInfoSchema` for `GET /api/chain`, `pendingPayout` on the
profile (optional `WeiSchema`).

### 4.5 Web app

- `lib/wallet`: a `localAccountWallet` built on viem `privateKeyToAccount`
  with the three Anvil keys (only used when `GET /api/chain` says
  `configured` and `chainId === 31337`); same `Wallet` interface as the mock.
  Selecting a role signs in (§4.3).
- `lib/chain`: viem public/wallet clients from `GET /api/chain`, typed calls
  using the shared ABIs: `fundBounty`, `stake`, `openDispute`, `rule`,
  `deleteBounty`, `refund`, `withdrawPayout`, each awaiting the receipt and
  then calling the matching API route.
- Flows: submit page funds after upload; StakeGate stakes on-chain (0.1 ETH
  requirement from `GET /api/chain`); dispute, rule, cancel, reclaim and
  withdraw buttons call chain then API; auditor id comes from the wallet
  (removing `SEED_AUDITOR_ID` imports from pages).
- Live mode: all routes above join `LIVE_ROUTES`; with the chain configured
  the demo banner and the "What happens next" and guide copy describe the
  real behaviour (60-second window, 0.1 ETH stake, 50% slash).
- Mock-only mode (`pnpm dev`) keeps working unchanged.

### 4.6 Error handling

- A reverted or rejected transaction shows the revert reason in the UI and
  calls no API route.
- A route whose on-chain confirmation fails returns 409 with the mismatch;
  the indexer later reconciles status anyway.
- The verdict loop, keeper and indexer log and retry; none of them crash the
  API. If the chain is down at startup the API starts without chain features
  and logs it.

## 5. Delivery (one PR each, into main, fresh reviewer before merge)

1. Rebase #39 and #42 onto main (Hein's branches).
2. Chain in the stack (§4.1).
3. Verdict hand-off, indexer start, status writes (§4.2).
4. Sign-in and new routes, disputes migration, shared additions (§4.3, §4.4).
5. Web wallet, chain calls and live wiring, copy (§4.5). Joshua reviews.
6. `scripts/demo-pipeline.sh` extended to the full lifecycle (cast for the
   user transactions), an end-to-end Playwright test of fund → stake → PoC →
   Paid, and updates to README, the M3 doc and the deck.

## 6. Testing

- API: route tests with fake chain ports (as #39 does) for every new route,
  including identity, 401/403/409 cases and idempotent replays; the verdict
  loop and indexer additions with memory stores; Postgres paths against the
  test database.
- Worker: `CHAIN_ENABLED` leaves the finding `Submitted`; without it,
  unchanged.
- Web: unit tests for the wallet and chain helpers with a mocked viem
  transport; component tests for each flow's success and revert paths.
- System: the extended demo script and a Playwright run against
  `pnpm stack:demo` covering the payout path and the dispute path.

## 7. Out of scope

- MetaMask or other injected wallets; Sepolia deployment; Azure.
- Multiple auditors per contract and auditor registration beyond the three
  dev accounts.
- Changing the contracts.
