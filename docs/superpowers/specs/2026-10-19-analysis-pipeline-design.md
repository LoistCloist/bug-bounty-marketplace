# Analysis pipeline design (Milestone 3 MVP)

- **Owner:** James Leung (Analysis Pipeline Lead)
- **Date:** 2026-10-19
- **Due:** Milestone 3 MVP, 2026-10-24
- **Requirements covered:** R2, R3, R5, R6, R7 (partly), R12, R15, R17, R19, R20

## 1. Goal

Replace the mocked analysis and sandbox timers with real services, working
end to end:

1. A developer uploads a `.sol` file. Slither analyses it, an LLM explains
   each finding in plain English, and the findings appear as `Flagged`.
2. An auditor claims the contract and uploads a Foundry PoC (`.t.sol`)
   against a finding. The PoC runs in an isolated Docker container. If it
   passes, the finding becomes `Verified`. If it fails, times out, or does not
   compile, the finding becomes `Rejected`.

Both flows must be visible in the existing web UI.

## 2. Scope

**In scope**

- `workers/analysis/`: a Python service (managed by `uv`) that runs analysis
  jobs and sandbox jobs.
- `workers/sandbox/`: the Docker image that PoCs run in.
- API: migrations, repositories and routes for findings, PoC submissions,
  jobs, the auditor queue and claims.
- One additive shared schema (`AnalysisStatus`) and one shared constant
  (`POC_SOURCE_MAX_BYTES`). No existing shared schema changes.
- Web: a "live pipeline" mode that sends the pipeline routes to the real API
  and keeps everything else on MSW.
- docker-compose services, a demo script, docs, and CI jobs.

**Out of scope** (owned by others or left for later)

- On-chain calls (`recordSubmission`, `recordVerification`, payout). These
  belong to the chain service. Findings stop at `Verified`. Nothing moves them
  to `Paid` in live mode.
- Real stake, profile, dispute, false-positive, reclaim, cancel and arbiter
  routes. These stay mocked.
- Auditors reporting a brand-new finding (R5's "or report a new finding").
- An Anvil fork of Sepolia. The PoC deploys the target contract itself
  inside a local `forge test`.

## 3. Architecture

```
Web (Next.js)                   Fastify API                       Postgres          workers/analysis (Python)
POST /api/contracts ──────────▶ store .sol, insert contract ────▶ jobs(analysis) ◀─ claim (FOR UPDATE SKIP LOCKED)
                                                                                     ├ slither --json
                                                                                     ├ LLM explain (fallback: Slither text)
GET  /api/contracts/:id/findings ◀──────────────────────────────── findings ◀────── └ insert Flagged findings
POST /api/auditor/poc ─────────▶ store .t.sol, finding→Submitted ▶ jobs(sandbox) ◀── claim
                                                                                     ├ docker run bbm-sandbox (no network)
                                                                                     └ Verified / Rejected + sandboxLog
```

- **Hand-off.** The API and the worker share Postgres and the source
  storage directory (`SOURCE_STORAGE_DIR`). The API inserts a row into
  `jobs`. The worker claims rows, does the work, and writes results to
  `findings` and `poc_submissions` in the same transaction that marks the job
  `done`.
- **Live mode.** Live mode needs `DATABASE_URL` and `SOURCE_STORAGE_DIR`.
  Without `DATABASE_URL` the API keeps today's in-memory behaviour: jobs are
  queued in memory and nothing processes them. API unit tests use this mode.

## 4. Data model (API migration `0002_analysis_pipeline.sql`)

```sql
ALTER TABLE contracts
  ADD COLUMN claimed_by_auditor_id TEXT,
  ADD COLUMN claim_expires_at      TIMESTAMPTZ;

CREATE TABLE findings (
  id                          TEXT PRIMARY KEY,
  contract_id                 TEXT NOT NULL REFERENCES contracts (id),
  severity                    TEXT NOT NULL CHECK (severity IN ('Critical','High','Medium','Low','Informational')),
  slither_detector            TEXT NOT NULL,
  slither_confidence          TEXT NOT NULL,
  raw_output                  JSONB NOT NULL,          -- this detector result, verbatim
  raw_output_reference        TEXT NOT NULL,           -- "/api/findings/<id>/raw"
  llm_explanation             TEXT NOT NULL,
  explanation_source          TEXT NOT NULL CHECK (explanation_source IN ('llm','slither')),
  status                      TEXT NOT NULL CHECK (status IN ('Flagged','Submitted','Verified','Disputed','Rejected','Paid')),
  status_history              JSONB NOT NULL,
  is_false_positive           BOOLEAN NOT NULL DEFAULT false,
  challenge_window_expires_at TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL
);

CREATE TABLE poc_submissions (
  id                  TEXT PRIMARY KEY,
  finding_id          TEXT NOT NULL REFERENCES findings (id),
  auditor_id          TEXT NOT NULL,
  test_file_reference TEXT NOT NULL,                   -- "pocs/<pocId>/<sha256>.t.sol" in source storage
  submitted_at        TIMESTAMPTZ NOT NULL,
  sandbox_status      TEXT NOT NULL CHECK (sandbox_status IN ('Pending','Passed','Failed')),
  sandbox_log         TEXT
);

CREATE TABLE jobs (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('analysis','sandbox')),
  subject_id       TEXT NOT NULL,                      -- contract id (analysis) or PoC id (sandbox)
  status           TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  attempts         INT  NOT NULL DEFAULT 0,
  last_error       TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX jobs_claimable_idx ON jobs (status, created_at);
CREATE INDEX jobs_subject_idx   ON jobs (subject_id);
```

**How DB rows map to the `Finding` schema.** The API maps rows onto the
existing `FindingSchema`:

- `claimedByAuditorId` and `claimExpiresAt` come from the parent contract's
  claim columns while the claim is active, and are `null` otherwise.
- `slither_confidence`, `raw_output` and `explanation_source` are internal
  columns. They are not exposed on `Finding`.

**New in `@bbm/shared`** (additive only; JSON Schema regenerated):

```ts
export const AnalysisJobStatusSchema = z.enum(["Queued", "Running", "Done", "Failed"]);
export const AnalysisStatusSchema = z.object({
  contractId: IdSchema,
  status: AnalysisJobStatusSchema,
  error: z.string().nullable(),      // set when Failed, e.g. the solc compile error
  findingCount: z.number().int().nonnegative(),
  updatedAt: TimestampSchema,
});
export const POC_SOURCE_MAX_BYTES = 102_400;
```

## 5. API routes

Every route validates its inputs. Responses use the shared schemas, or the
web's existing `QueueItem` shape for the queue.

| Route | Behaviour | Errors |
| --- | --- | --- |
| `POST /api/contracts` (exists) | Additionally inserts an `analysis` job in the same DB transaction | unchanged |
| `GET /api/contracts?developerAddress=` | Lists contracts, newest first | 400 bad address |
| `GET /api/contracts/:id` (exists) | Unchanged, except an expired claim reads back as `Open` | 404 |
| `GET /api/contracts/:id/findings` | `Finding[]`, ordered by severity then creation time | 404 contract |
| `GET /api/contracts/:id/analysis` | `AnalysisStatus` from the contract's latest analysis job | 404 |
| `GET /api/findings/:id/raw` | That finding's raw Slither detector JSON (R15) | 404 |
| `GET /api/auditor/queue?sort=deadline\|bounty\|newest` | Contracts that are `Open`, or `Claimed` with an expired claim, joined with `bounty {amount,currency}` | 400 bad sort |
| `POST /api/auditor/claim {contractId, auditorId}` | Atomic `UPDATE … WHERE status='Open' OR claim expired`. Sets `Claimed`, the claimant, and `claim_expires_at = now + CLAIM_WINDOW_SECONDS` | 400, 404, 409 already claimed |
| `POST /api/auditor/poc` (multipart `findingId`, `auditorId`, `file`) | Checks the file (`.t.sol`, at most `POC_SOURCE_MAX_BYTES`). Checks the finding is `Flagged` and the contract is claimed by this auditor with the claim still active. Stores the file, inserts a `Pending` PoC, sets the finding to `Submitted` (history appended) and inserts a `sandbox` job, all in one transaction. Returns `201 PoCSubmission`. | 400, 404, 403 not your claim or claim expired, 409 finding not `Flagged`, 413 |

**Config** (env, with defaults):

- `CLAIM_WINDOW_SECONDS=600` (matches the mock)
- `CHALLENGE_WINDOW_SECONDS=86400`
- `JOB_MAX_ATTEMPTS=3`

**Stake.** Stake is still mocked, so the PoC route does not check it. This is
a known limitation.

## 6. Worker (`workers/analysis/`)

**Layout.** `pyproject.toml` (uv), `Dockerfile`, `.env.example`,
`src/bbm_analysis/` with:

- `config.py`: reads env and holds the supported solc list
- `models/`: generated from `packages/shared/schema/*.json` by
  `datamodel-code-generator` and committed; CI fails if it is stale
- `jobs.py`: claim, complete and fail
- `slither_runner.py`
- `findings.py`: Slither JSON → finding rows
- `llm.py`
- `sandbox.py`
- `main.py`: the poll loop
- `tests/`

### 6.1 Job loop

The worker polls every `POLL_INTERVAL_SECONDS=1`. Each poll runs this claim
query:

```sql
UPDATE jobs SET status='running', attempts=attempts+1,
       lease_expires_at = now() + make_interval(secs => $lease), updated_at = now()
WHERE id = (SELECT id FROM jobs
            WHERE (status='queued' OR (status='running' AND lease_expires_at < now()))
              AND attempts < $max_attempts
            ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *;
```

- **Expired jobs.** A separate statement on each poll marks jobs `failed`
  when their lease has expired and they have reached `attempts >= max`.
  - An expired sandbox job leaves its finding `Submitted`.
  - An expired analysis job shows as `Failed` on `/analysis`.
- **Lease length.** `JOB_LEASE_SECONDS=600`. This is longer than any single
  step's timeout.
- **Concurrency.** `WORKER_CONCURRENCY=2` jobs run at once (threads), so a
  slow job does not block the queue (R20).
- **Job outcomes.** Each handler returns one of two outcomes:
  - `done`: results are written in the same transaction.
  - `failed(reason, retryable)`: if retryable and attempts remain, the job
    goes back to `queued`. Otherwise it becomes `failed`.

### 6.2 Analysis job

1. Load the contract row and read the source from
   `SOURCE_STORAGE_DIR/<sourceReference>`. Check its sha256 against
   `source_hash`; on a mismatch, fail the job without retrying.
2. **Pick a solc version.** Parse the `pragma solidity` constraint and choose
   the highest version in `SUPPORTED_SOLC` that satisfies it.
   - `SUPPORTED_SOLC` is `0.8.19`, `0.8.20`, `0.8.24`, `0.8.26`, `0.8.28`
     and `0.7.6`. It is defined once in `workers/solc-versions.txt` and
     baked into both images.
   - No pragma means the latest supported version.
   - If nothing matches, fail without retrying:
     `Unsupported Solidity version: <pragma>`.
3. Run `slither <tmp>/<filename> --json <tmp>/out.json` with
   `SOLC_VERSION=<picked>` and a 120 s timeout.
   - A compile failure or timeout fails the job without retrying, and the
     solc error text goes into `last_error`.
   - Slither runs only the compiler, not contract code, so it runs in the
     worker process rather than the sandbox.
4. Map each `results.detectors[]` entry to one finding.
   - **Severity** comes from Slither's `impact`: `High`→High, `Medium`→Medium,
     `Low`→Low, `Informational`→Informational. `Optimization` entries are
     dropped.
   - `slitherDetector` is the detector's `check` value, and `raw_output` is
     the entry verbatim.
5. Call the LLM (§6.3) to fill in `llmExplanation`.
6. Insert all findings as `Flagged`, each with
   `statusHistory=[{Flagged, now}]`, and mark the job `done` in one
   transaction.
   - A contract with zero findings is a valid `Done` result.

### 6.3 LLM explainer (advisory only, R3/R15)

- **Endpoint.** Azure AI Foundry, serving Grok, reached through the
  OpenAI-compatible chat-completions API with the `openai` Python SDK.
  - Configured by `LLM_ENDPOINT`, `LLM_API_KEY` and `LLM_MODEL` (the
    deployment name).
  - The exact base-URL format is confirmed with one manual smoke call during
    implementation.
- **One call per contract.**
  - **System prompt:** the role, the fact that output is advisory, and the
    JSON output format.
  - **User content:** the full contract source (at most 100 KB; Azure terms:
    prompts are not used for training) plus a numbered list of findings
    (`index`, `check`, `impact`, `confidence`, `description`).
- **Output format.**
  `{"explanations":[{"index":0,"explanation":"..."}]}`. Each explanation is at
  most about 120 words and covers what is wrong, how it could be exploited,
  and how to fix it. The worker requests JSON mode when it is available and
  parses it defensively.
- **Fallbacks.**
  - The call has a 30 s timeout and 1 retry.
  - Any finding without a valid explanation gets Slither's `description`
    instead, with `explanation_source='slither'`.
  - If the LLM is not configured (no key), every finding falls back.
- **No effect on status.** The LLM's output never changes a finding's
  status, severity or count.

### 6.4 Sandbox job (R6, R12, R19)

1. Load the PoC, its finding and its contract. Read the target source and
   the PoC file.
2. **Build an in-memory tar** containing:
   - `foundry.toml`, with `offline=true`, `src="src"`, `test="test"`,
     `libs=[]` and the remapping `forge-std/=/opt/forge-std/src/`
   - `src/<contract filename>`
   - `test/PoC.t.sol`

   PoCs import the target as `import "../src/<filename>";`. This convention
   is documented for auditors.
3. **Run the container.** Pipe the tar into this command:

   ```
   docker run --rm -i --name bbm-sandbox-<pocId> --network none --memory 1g --cpus 1 \
     --pids-limit 256 --read-only --tmpfs /tmp:rw,exec,size=256m --cap-drop ALL \
     --security-opt no-new-privileges --user 1000:1000 bbm-sandbox:latest \
     sh -c 'mkdir -p /tmp/w && tar -x -C /tmp/w && cd /tmp/w && forge test -vvv'
   ```

   Using stdin avoids bind mounts, so the worker can itself run in a
   container with the Docker socket mounted.
4. **Time limit.** The timeout is `SANDBOX_TIMEOUT_SECONDS=120`. When it
   fires, the worker runs `docker kill bbm-sandbox-<pocId>`. The result is
   `Failed`, and the log reads `Timed out after 120s`.
5. **Deciding the result.**
   - `Passed`: the exit code is 0 and forge's summary reports at least one
     passed test.
   - `Failed`: anything else, including a compile error or failing tests.
   - The log is stdout+stderr, keeping the last 64 KB.
6. **Writing the result** (one transaction):
   - `Passed`: the PoC is set to `Passed`, the finding to `Verified` (history
     appended) with
     `challenge_window_expires_at = now + CHALLENGE_WINDOW_SECONDS`, and the
     job to `done`.
   - `Failed`: the PoC is set to `Failed`, the finding to `Rejected` (history
     appended), and the job to `done`.
7. **Docker failures.** If the Docker daemon is unreachable or the image is
   missing, the job is retried and the finding is not rejected.

**Image `workers/sandbox/Dockerfile`:**

- Contents: the Foundry toolchain pinned to a version, `forge-std` at the
  same commit as `contracts/lib/forge-std` copied to `/opt/forge-std`, every
  `SUPPORTED_SOLC` version pre-installed in the image's compiler folder, and
  a non-root user 1000.
- Tag: `bbm-sandbox:latest`.

## 7. Web live mode (PR E)

- **Turning it on.** Set `NEXT_PUBLIC_LIVE_PIPELINE=enabled` together with
  `NEXT_PUBLIC_API_MOCKING=enabled`. `API_URL` is the address of the real
  API (default `http://localhost:3001`).
- **Which routes go live.** `src/mocks/handlers/index.ts` leaves out the MSW
  handlers for the live routes, which are:
  - `POST/GET /api/contracts`
  - `GET /api/contracts/:id`
  - `GET /api/contracts/:id/findings`
  - `GET /api/contracts/:id/analysis`
  - `GET /api/findings/:id/raw`
  - `GET /api/auditor/queue`
  - `POST /api/auditor/claim`
  - `POST /api/auditor/poc`

  All other routes are still handled by MSW.
- **Proxy.** `next.config.ts` rewrites `/api/:path*` to
  `${API_URL}/api/:path*`. Only requests that MSW passes through reach it.
- **Raw output link.** The finding card's "raw Slither output" toggle links
  to `rawOutputReference` when it starts with `/api/`.
- **Failed analysis.** The contract page shows the `/analysis` error when it
  is `Failed`.
- **Ownership.** Files touched under `apps/web` are flagged for Joshua
  (frontend lead) in the PR description.

## 8. Error handling summary

| Case | Result |
| --- | --- |
| Source hash mismatch, unsupported pragma, compile error, Slither timeout | Analysis `Failed` with the error text, no retry |
| LLM error, timeout or bad JSON | Fall back to Slither text; findings are still created |
| PoC compile error, failing test, timeout | PoC `Failed`, finding `Rejected`, log saved |
| Docker unavailable | Retry; after max attempts the job is `failed` and the finding stays `Submitted` (known issue) |
| Worker crash mid-job | Lease expires and the job is retried (at most 3 attempts) |
| Duplicate PoC on a finding | 409 (finding no longer `Flagged`) |
| Two auditors claim at once | One wins (atomic UPDATE), the other gets 409 |

## 9. Testing

| Area | Tests | Where it runs |
| --- | --- | --- |
| Worker unit | pragma → solc selection; Slither JSON → findings (fixture from a real run); LLM client vs fake HTTP (success, timeout, bad JSON, partial, no key); sandbox command building, pass/fail parsing, timeout kills the container, Docker-down is retryable; job claim/complete/fail/lease expiry | CI `worker-analysis` job (Postgres service container) |
| Worker integration (`-m slither`) | Real Slither on `fixtures/Vault.sol` produces a `reentrancy-eth` finding | CI (solc versions installed via solc-select) |
| Sandbox integration (`-m docker`) | Builds `bbm-sandbox`; `PoC_pass.t.sol` → Passed, `PoC_fail.t.sol` → Failed, `PoC_hang.t.sol` → Failed by timeout, `PoC_network.t.sol` (FFI/network attempt) → Failed | CI `sandbox` job |
| API | Route tests with in-memory repos for every new route and error code; Pg repository tests (skipped without `DATABASE_URL`, as today) | CI `api` job |
| Shared | Schema tests for `AnalysisStatus`; `gen:schema` staleness check | CI `shared` job |
| Web | Live mode removes exactly the live routes from the MSW handlers | CI `web` job |
| End to end | `scripts/demo-pipeline.sh`: submit `Vault.sol` → wait for findings → claim → submit passing PoC → `Verified`; then a failing PoC on another finding → `Rejected` | Manual rehearsal; used in the M3 run instructions |

No test calls the real LLM endpoint. CI adds two path-filtered jobs, and both
are added to `CI OK`'s `needs`:

- `worker-analysis` triggers on `workers/analysis/**`,
  `workers/solc-versions.txt` or `packages/shared/schema/**`.
- `sandbox` triggers on `workers/sandbox/**`, `workers/solc-versions.txt` or
  `workers/analysis/src/bbm_analysis/sandbox.py`.

## 10. Delivery

| Day | Branch → PR into `main` | Contents |
| --- | --- | --- |
| Mon 10/20 | `feat/analysis-worker-slither` | This spec, worker skeleton, solc selection, Slither runner + parser, fixtures, CI job |
| Tue 10/21 | `feat/api-pipeline-routes` | Shared additions, migration 0002, repositories, routes, enqueue on submit |
| Tue 10/21 | `feat/analysis-worker-jobs` | Job loop, LLM explainer, analysis job end to end against Postgres |
| Wed 10/22 | `feat/poc-sandbox` | Sandbox image, runner, sandbox job, CI job |
| Thu 10/23 | `feat/web-live-pipeline` | Web live mode, docker-compose services, demo script, docs |
| Fri 10/24 | — | Buffer; M3 doc rows (features, design changes, tests, known issues, run steps) |

Every PR gets a fresh reviewer sub-agent pass before merge. The reviewer
checks correctness and test coverage, schema consistency, accidental real
network calls, and scope creep. Merges are merge commits.

## 11. Known limitations (for the M3 write-up)

- Stake, dispute, false-positive and payout stay mocked in live mode. Findings
  stop at `Verified`.
- A trivially passing PoC (`assertTrue(true)`) is `Verified`. The dispute
  flow is the backstop.
- A contract that does not compile is stored first and then shows a `Failed`
  analysis. US1 says "nothing is stored" in this case.
- Only the solc versions in `SUPPORTED_SOLC` are accepted, and only
  single-file contracts (no imports other than `forge-std` in PoCs).
- The worker's Docker access (socket mount) is powerful. It is acceptable for
  the MVP but needs a hardened runner (e.g. gVisor) later.
- If Docker is down long enough to exhaust retries, the finding stays
  `Submitted` until someone re-queues the job manually.

## 12. Design changes since Milestone 2

- LLM: Gemini → Grok on Azure AI Foundry. The team has a key, and Azure does
  not use prompts for training, so the full source can be sent.
- No Sepolia fork in the sandbox. The PoC deploys the target locally.
- Job queue: a Postgres `jobs` table, so no new infrastructure is needed.

## 13. Addendum: integration with the DevOps milestone (2026-10-20)

While this pipeline was built, the DevOps milestone (PRs #16–#25) landed on
`main` with its own `workers/analysis` skeleton (FastAPI, `/health` on :8000,
package `analysis`, `scripts/gen-types.sh`), production Dockerfiles, a
compose stack that waits on every healthcheck, Helm charts and an ADR that
plans an Azure Storage Queue (`analysis-jobs`, KEDA) and Kata sandbox pods.
To fit that layout rather than replace it:

- The worker code lives in the existing `analysis` package and uses its
  generated models and `to_iso_z`. The job poller runs inside the FastAPI
  service (started on boot when `DATABASE_URL` is set), so `/health`, the
  compose healthcheck and the non-root image check keep working.
  `POST /analyze` becomes a real, stateless Slither + LLM call.
- The shared solc list moves to `workers/analysis/solc-versions.txt` (the
  analysis image's build context is `workers/analysis`).
- The Postgres `jobs` table stays the queue for the MVP; it runs locally and
  against the Azure Postgres Flexible Server. Moving to the planned
  `analysis-jobs` Storage Queue is a follow-up.
- `docker run` sandboxing works locally through an opt-in compose file that
  mounts the Docker socket; the Kata pod runner in AKS is a follow-up.
- The web live mode uses the existing `/api` proxy (`API_INTERNAL_URL`)
  instead of a Next.js rewrite, and the API keeps its existing Dockerfile.

