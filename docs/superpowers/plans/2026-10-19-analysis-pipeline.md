# Analysis Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mocked analysis/sandbox timers with a real Slither + LLM analysis worker and a Docker PoC sandbox, wired through the Fastify API and shown in the existing web UI.

**Architecture:** The API writes contracts, PoCs and `jobs` rows to Postgres. A Python worker (`workers/analysis`) claims jobs with `FOR UPDATE SKIP LOCKED`. It runs Slither and the LLM for analysis jobs, and `docker run bbm-sandbox` for sandbox jobs, then writes findings or verdicts back in the same transaction. The web gets a "live pipeline" mode that proxies only the pipeline routes to the real API and keeps MSW for the rest.

**Tech Stack:** Python 3.12 + uv, psycopg 3, slither-analyzer, solc-select, openai SDK (Azure AI Foundry, Grok), semantic_version, pytest, ruff, datamodel-code-generator; Fastify 5 + pg + Vitest; Foundry in Docker; Next.js 16 + MSW.

**Spec:** `docs/superpowers/specs/2026-10-19-analysis-pipeline-design.md` (read it first; section numbers below are its sections)

## Global Constraints

- Supported solc versions: `0.8.19, 0.8.20, 0.8.24, 0.8.26, 0.8.28, 0.7.6`. Single source: `workers/solc-versions.txt`, one per line.
- Timeouts: Slither 120 s, LLM 30 s + 1 retry, sandbox `SANDBOX_TIMEOUT_SECONDS=120`.
- Worker env defaults: `POLL_INTERVAL_SECONDS=1`, `JOB_LEASE_SECONDS=600`, `JOB_MAX_ATTEMPTS=3`, `WORKER_CONCURRENCY=2`.
- API env defaults: `CLAIM_WINDOW_SECONDS=600`, `CHALLENGE_WINDOW_SECONDS=86400`, `JOB_MAX_ATTEMPTS=3`.
- LLM env: `LLM_ENDPOINT`, `LLM_API_KEY`, `LLM_MODEL`. No key means every explanation falls back to Slither text.
- Upload caps: `.sol` and `.t.sol` are each at most 102_400 bytes (`CONTRACT_SOURCE_MAX_BYTES`, `POC_SOURCE_MAX_BYTES`).
- Sandbox log: keep the last 65_536 bytes.
- Storage keys: sources `contracts/<id>/<sha256>.sol` (exists); PoCs `pocs/<pocId>/<sha256>.t.sol`. `rawOutputReference` = `/api/findings/<id>/raw`.
- IDs: `finding_<uuid4>`, `poc_<uuid4>`, `job_<uuid4>`.
- No test may call the real LLM endpoint or any other network service. The Docker and Slither integration tests are opt-in markers.
- Migrations must be idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) because `runMigrations` re-applies every file on boot.
- Never commit `.env`; commit `workers/analysis/.env.example` with names only.
- Conventional Commits; every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run lint/typecheck/test for every package touched before each commit.
- PR flow per `CLAUDE.md`: branch from the latest `main` → `gh pr create` into `main` → wait for CI → fresh reviewer sub-agent on the PR diff (correctness and tests, schema consistency, real network calls, scope creep) → `gh pr merge --merge --delete-branch`. If merging is blocked by a required approval, stop and ask James to get a teammate to approve.

## Review Focus

- **Hostile or odd contract filenames** (`../../x.sol`, `My Vault.sol`). Expect the worker to use only a sanitised basename (`[A-Za-z0-9_.-]`, other characters become `_`) for temp files and the tar. Never write outside its temp directory. Pinned in Task 3 and Task 12.
- **Sources with a UTF-8 BOM, CRLF line endings, or invalid UTF-8.** Expect pragma detection to still work. Bytes are passed to solc unchanged. Pinned in Task 2.
- **A contract with very many findings** (e.g. 120). Expect only the first 50 to be sent to the LLM; the rest fall back to Slither text; all are stored. Pinned in Task 9.
- **A PoC that prints megabytes of output.** Expect the log to be truncated to the last 64 KB and the verdict to still be parsed from the full output. Pinned in Task 12.
- **Claim expiry boundaries.** Expect:
  - a PoC from an auditor whose claim has expired → 403;
  - a second auditor can claim an expired claim;
  - `GET /api/contracts/:id` shows `Open` once the claim has expired;
  - two simultaneous claims → exactly one 200.

  Pinned in Task 6 and Task 7.

---

## PR A — `feat/analysis-worker-slither` (Mon 10/20)

Branch already exists with the spec commit (`60a5d5b`).

### Task 1: Worker skeleton, toolchain and generated models

**Files:**
- Create: `workers/solc-versions.txt`, `workers/analysis/pyproject.toml`, `workers/analysis/uv.lock`, `workers/analysis/.env.example`, `workers/analysis/Dockerfile`, `workers/analysis/scripts/gen-models.sh`, `workers/analysis/src/bbm_analysis/__init__.py`, `workers/analysis/src/bbm_analysis/config.py`, `workers/analysis/src/bbm_analysis/models/` (generated), `workers/analysis/tests/test_config.py`, `workers/analysis/tests/test_models.py`
- Modify: `docs/workers.md` (replace "No service exists yet" with the `analysis` service description, setup and env table), `docs/README.md` (link the spec and plan)

**Interfaces:**
- Produces:
  - `bbm_analysis.config.Settings` (frozen dataclass) with these fields:
    - `database_url: str | None`
    - `source_storage_dir: Path | None`
    - `poll_interval_s: float`, `job_lease_s: int`, `job_max_attempts: int`, `worker_concurrency: int`
    - `llm_endpoint: str | None`, `llm_api_key: str | None`, `llm_model: str | None`
    - `sandbox_timeout_s: int`, `sandbox_image: str` (default `"bbm-sandbox:latest"`)
    - `supported_solc: tuple[str, ...]`
  - `Settings.from_env(env: Mapping[str, str] = os.environ) -> Settings`
  - `Settings.llm_configured -> bool`
  - `bbm_analysis.config.load_supported_solc(path: Path | None = None) -> tuple[str, ...]`
  - `bbm_analysis.models` exposing pydantic v2 models `Finding`, `PoCSubmission`, `Contract` (generated)

- [ ] **Step 1: Install toolchain (user-local, no sudo).** Run `curl -LsSf https://astral.sh/uv/install.sh | sh`, then `uv --version`. Expected: version printed. Foundry is installed in Task 11.
- [ ] **Step 2: Write failing tests.**

```python
# tests/test_config.py
def test_defaults_from_empty_env():
    s = Settings.from_env({})
    assert (s.poll_interval_s, s.job_lease_s, s.job_max_attempts, s.worker_concurrency) == (1.0, 600, 3, 2)
    assert s.sandbox_timeout_s == 120 and s.sandbox_image == "bbm-sandbox:latest"
    assert s.llm_configured is False

def test_llm_configured_needs_all_three():
    env = {"LLM_ENDPOINT": "https://x", "LLM_API_KEY": "k", "LLM_MODEL": "grok"}
    assert Settings.from_env(env).llm_configured is True
    assert Settings.from_env({**env, "LLM_MODEL": ""}).llm_configured is False

def test_supported_solc_read_from_shared_file():
    assert load_supported_solc() == ("0.8.19", "0.8.20", "0.8.24", "0.8.26", "0.8.28", "0.7.6")

# tests/test_models.py
def test_generated_finding_model_accepts_shared_shape():
    Finding.model_validate({...})  # a valid Flagged finding dict with every FindingSchema field
```

- [ ] **Step 3: Run** `cd workers/analysis && uv run pytest -q`. Expected: FAIL (import errors).
- [ ] **Step 4: Implement.**
  - **`pyproject.toml`** (src layout, package `bbm_analysis`, `requires-python = ">=3.12"`):
    - runtime deps: `psycopg[binary]>=3.2`, `openai>=1.50`, `semantic-version>=2.10`, `slither-analyzer>=0.10`, `solc-select>=1.0`, `pydantic>=2.8`
    - dev group: `pytest`, `ruff`, `datamodel-code-generator` (HTTP fakes use `httpx.MockTransport`, so no mocking library is needed)
    - pytest markers `slither` and `docker`; `addopts = "-m 'not slither and not docker'"`
    - console script `bbm-analysis = "bbm_analysis.main:main"`
  - **`gen-models.sh`:** runs `datamodel-codegen --input ../../packages/shared/schema --input-file-type jsonschema --output src/bbm_analysis/models --output-model-type pydantic_v2.BaseModel --disable-timestamp`.
  - **`Dockerfile`:** based on `python:3.12-slim`. Installs uv, the docker CLI (`docker.io` client only) and every solc in `solc-versions.txt` via `solc-select install`. Runs `uv sync --frozen --no-dev`, sets `CMD ["uv","run","bbm-analysis"]`, and runs as a non-root user.
  - **`.env.example`:** lists every env name from Global Constraints plus `DATABASE_URL` and `SOURCE_STORAGE_DIR`.
- [ ] **Step 5: Run** `uv run pytest -q && uv run ruff check . && ./scripts/gen-models.sh && git diff --exit-code src/bbm_analysis/models`. Expected: all pass, no diff.
- [ ] **Step 6: Commit** `feat(workers): scaffold analysis worker with config and generated models`.

### Task 2: Solc version selection

**Files:** Create `workers/analysis/src/bbm_analysis/solc.py`, `workers/analysis/tests/test_solc.py`

**Interfaces:**
- Produces:
  - `class UnsupportedSolcError(Exception)`, whose message is exactly `"Unsupported Solidity version: <pragma text>"`
  - `pick_solc(source: bytes, supported: Sequence[str]) -> str`

- [ ] **Step 1: Write failing tests**, each a separate `test_*` with these exact cases. `S` is the default supported tuple.
  - `b"pragma solidity ^0.8.19;"` → `"0.8.28"`
  - `b"pragma solidity 0.8.19;"` and `b"pragma solidity =0.8.19;"` → `"0.8.19"`
  - `b"pragma solidity >=0.8.0 <0.8.21;"` → `"0.8.20"`
  - `b"pragma solidity >=0.7.0 <0.8.0;"` → `"0.7.6"`
  - `b"pragma solidity ^0.8.0 || ^0.7.0;"` → `"0.8.28"`
  - no pragma → `"0.8.28"`
  - `b"pragma solidity ^0.6.0;"` → raises with message `"Unsupported Solidity version: ^0.6.0"`
  - UTF-8 BOM + CRLF + `pragma solidity ^0.8.19;\r\n` → `"0.8.28"`
  - invalid UTF-8 bytes elsewhere in the file (`b"\xff\xfe"` in a comment) → still `"0.8.28"`
  - a pragma inside a `//` comment before the real one is ignored: `b"// pragma solidity ^0.6.0;\npragma solidity ^0.8.19;"` → `"0.8.28"`
- [ ] **Step 2: Run** `uv run pytest tests/test_solc.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  1. Decode with `errors="replace"` and strip `//` and `/* */` comments.
  2. Find the first `pragma solidity <spec>;` with a regex.
  3. Normalise `=X` to `==X` and space-separated ranges to npm form.
  4. Choose `max(v for v in supported if v in semantic_version.NpmSpec(spec))`.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(workers): pick solc version from contract pragma`.

### Task 3: Slither runner and detector parser

**Files:**
- Create: `workers/analysis/src/bbm_analysis/slither_runner.py`, `workers/analysis/src/bbm_analysis/findings.py`, `workers/analysis/tests/fixtures/Vault.sol`, `workers/analysis/tests/fixtures/vault-slither.json`, `workers/analysis/tests/test_findings.py`, `workers/analysis/tests/test_slither_runner.py`
- Create (shared helper): `workers/analysis/src/bbm_analysis/paths.py`

**Interfaces:**
- Produces:
  - `paths.safe_filename(name: str) -> str`. Basename only. Every character outside `[A-Za-z0-9_.-]` becomes `_`. Must still end in `.sol`, otherwise `"Contract.sol"`.
  - `class SlitherError(Exception)` carrying `message: str`.
  - `run_slither(source: bytes, filename: str, solc_version: str, timeout_s: int = 120) -> dict`
    - writes `safe_filename(filename)` into a `TemporaryDirectory`;
    - runs `slither <file> --json <tmp>/out.json` with env `SOLC_VERSION`;
    - returns the parsed JSON;
    - raises `SlitherError` when it times out (`"Slither timed out after 120s"`), when the JSON is missing, or when `success` is false (message = JSON `error`, else stderr tail).
  - `@dataclass(frozen=True) class DetectorResult` with fields `index: int`, `check: str`, `impact: str`, `confidence: str`, `description: str`, `raw: dict`.
  - `parse_detectors(slither_json: dict) -> list[DetectorResult]`. Drops `impact == "Optimization"`. `index` counts from 0 over the kept results.
  - `severity_for(impact: str) -> str` mapping High/Medium/Low/Informational one-to-one. Raises `ValueError` otherwise.

- [ ] **Step 1: Create fixtures.**
  - `Vault.sol`: pragma `^0.8.19`, `deposit()`, `withdraw()` that does `call{value: bal}("")` before `balances[msg.sender] = 0`.
  - `vault-slither.json`: a real recorded run. Generate it once with `uv run solc-select install 0.8.28 && SOLC_VERSION=0.8.28 uv run slither tests/fixtures/Vault.sol --json tests/fixtures/vault-slither.json` and commit it.
- [ ] **Step 2: Write failing tests.**
  - `test_parse_vault_fixture_has_reentrancy`: some result has `check == "reentrancy-eth"` and `severity_for(r.impact) == "High"`.
  - `test_parse_drops_optimization`: a hand-built JSON with one `Optimization` and one `Low` result → only the `Low` result, with `index == 0`.
  - `test_parse_empty_results`: `{"success": True, "results": {}}` → `[]`.
  - `test_severity_for_unknown_raises`.
  - `test_safe_filename`: `"../../evil.sol"` → `"evil.sol"`; `"My Vault.sol"` → `"My_Vault.sol"`; `"x.txt"` → `"Contract.sol"`.
  - `test_run_slither_reports_error_field` (monkeypatch `subprocess.run` to write `{"success": false, "error": "ParserError: x"}`) → `SlitherError("ParserError: x")`.
  - `test_run_slither_timeout` (monkeypatch to raise `TimeoutExpired`) → message `"Slither timed out after 120s"`.
  - `@pytest.mark.slither test_real_slither_on_vault`: real run → `parse_detectors` contains `reentrancy-eth`.
- [ ] **Step 3: Run** `uv run pytest -q`. Expected: FAIL.
- [ ] **Step 4: Implement** the functions above. Slither's exit code is non-zero when it finds issues, so success is decided from the JSON, never from the exit code.
- [ ] **Step 5: Run** `uv run pytest -q && uv run pytest -m slither -q`. Expected: PASS (the second needs `solc-select install 0.8.28`).
- [ ] **Step 6: Commit** `feat(workers): run Slither and map detector results to findings`.

### Task 4: CI job `worker-analysis`, then open PR A

**Files:** Modify `.github/workflows/ci.yml`, `README.md` (CI table row)

- [ ] **Step 1: Add a `worker-analysis` output to the `changes` filter** with paths `workers/analysis/**`, `workers/solc-versions.txt`, `packages/shared/schema/**`, `apps/api/src/db/migrations/**` (worker tests apply the API migrations).
- [ ] **Step 2: Add a `worker-analysis` job.** It runs under `working-directory: workers/analysis` with a `postgres:16-alpine` service (`bbm/bbm/bbm`, port 5432) and env `DATABASE_URL=postgres://bbm:bbm@localhost:5432/bbm`. Steps:
  1. `astral-sh/setup-uv@v3` (cache on)
  2. `uv sync --frozen`
  3. `uv run ruff check .`
  4. `./scripts/gen-models.sh && git diff --exit-code src/bbm_analysis/models`
  5. `uv run pytest -q`
  6. `xargs -a ../solc-versions.txt -n1 uv run solc-select install`
  7. `uv run pytest -m slither -q`
- [ ] **Step 3: Add `worker-analysis` to `ci-ok.needs` and its `results` map.**
- [ ] **Step 4: Verify** with `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` → no error. Run `uv run pytest -q` locally again.
- [ ] **Step 5: Commit** `ci: add path-filtered worker-analysis job`.
- [ ] **Step 6: Push and open the PR.** `git push -u origin feat/analysis-worker-slither`, then `gh pr create --base main` with a summary, the spec link, and a test plan. Wait for CI. `gh pr checks --watch` must be green.
- [ ] **Step 7: Review and merge.** Dispatch a fresh reviewer sub-agent on `gh pr diff` (CLAUDE.md checklist). Fix findings, re-push, then `gh pr merge --merge --delete-branch`. `git switch main && git pull --ff-only`.

---

## PR B — `feat/api-pipeline-routes` (Tue 10/21)

`git switch -c feat/api-pipeline-routes` from the updated `main`.

### Task 5: Shared schema additions

**Files:**
- Create: `packages/shared/src/analysis.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/poc-submission.ts`, `packages/shared/scripts/gen-schema.ts`, `packages/shared/src/__tests__/schemas.test.ts`, `packages/shared/src/__tests__/schema-output.test.ts`
- Generated: `packages/shared/schema/AnalysisStatus.json`, `workers/analysis/src/bbm_analysis/models/*`

**Interfaces:**
- Produces (from `@bbm/shared`):
  - `AnalysisJobStatusSchema` (`"Queued"|"Running"|"Done"|"Failed"`) and `AnalysisStatusSchema`, exactly as in spec §4, plus the inferred types `AnalysisJobStatus` and `AnalysisStatus`
  - `POC_SOURCE_MAX_BYTES = 102_400`
  - `PocSourceFilenameSchema`: string ending `.t.sol` (case-insensitive), error `"Filename must end in .t.sol"`
  - `PocSourceSizeSchema`: like `ContractSourceSizeSchema`, with error `"PoC file exceeds the 100 KB limit"`

- [ ] **Step 1: Write failing tests** in `schemas.test.ts`:
  - `AnalysisStatusSchema` accepts `{contractId:"c", status:"Failed", error:"ParserError", findingCount:0, updatedAt:<iso>}` and rejects `findingCount:-1`.
  - `PocSourceFilenameSchema` accepts `"Exploit.t.sol"` and rejects `"Exploit.sol"`.
  - `PocSourceSizeSchema` rejects `102_401`.

  Add `AnalysisStatus` to the `entities` map in `schema-output.test.ts`.
- [ ] **Step 2: Run** `pnpm --filter @bbm/shared test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `AnalysisStatus` to the `gen-schema.ts` entities. Run `pnpm --filter @bbm/shared gen:schema`, then `cd workers/analysis && ./scripts/gen-models.sh`.
- [ ] **Step 4: Run** `pnpm --filter @bbm/shared lint && pnpm --filter @bbm/shared typecheck && pnpm --filter @bbm/shared test && (cd workers/analysis && uv run pytest -q)`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): add AnalysisStatus schema and PoC upload limits`.

### Task 6: Migration 0002 and repositories

**Files:**
- Create: `apps/api/src/db/migrations/0002_analysis_pipeline.sql`, `apps/api/src/pipeline/repository.ts`, `apps/api/src/pipeline/memory-repository.ts`, `apps/api/src/pipeline/pg-repository.ts`, `apps/api/src/pipeline/pg-repository.test.ts`, `apps/api/src/pipeline/memory-repository.test.ts`
- Modify: `apps/api/src/contracts/repository.ts`, `apps/api/src/contracts/memory-repository.ts`, `apps/api/src/contracts/pg-repository.ts`, `apps/api/src/contracts/pg-repository.test.ts`, `.github/workflows/ci.yml` (api job: add the same Postgres service + `DATABASE_URL` so the pg tests run in CI)

**Interfaces:**
- Produces (`contracts/repository.ts`):
  - `NewContractRecord` gains `analysisJob: NewJob`. `insertContract` writes contract, bounty and job in one transaction.
  - `listContracts(filter: { developerAddress?: string }): Promise<Contract[]>`, newest first.
  - `findContractById` returns `status: "Open"` when the stored status is `Claimed` and `claim_expires_at <= now`.
  - `claimContract(contractId: string, auditorId: string, expiresAt: Date, now: Date): Promise<ClaimResult>`, where `ClaimResult = { ok: true; contract: Contract } | { ok: false; reason: "not_found" | "not_open" }`. This is a single atomic `UPDATE … WHERE id=$1 AND (status='Open' OR (status='Claimed' AND claim_expires_at <= $now)) RETURNING`.
  - `listQueue(now: Date): Promise<Array<Contract & { bounty: { amount: number; currency: string } }>>`
  - `findActiveClaim(contractId: string, now: Date): Promise<{ auditorId: string; expiresAt: Date } | null>`
- Produces (`pipeline/repository.ts`):
  - `NewJob = { id: string; kind: "analysis" | "sandbox"; subjectId: string; createdAt: string }`
  - `PipelineRepository`:
    - `listFindings(contractId: string, now: Date): Promise<Finding[]>`. Ordered by severity Critical→Informational, then `created_at`. Fills `claimedByAuditorId`/`claimExpiresAt` from the active claim.
    - `findFinding(id: string, now: Date): Promise<(Finding & { contract: Contract }) | null>`
    - `getRawOutput(findingId: string): Promise<unknown | null>`
    - `getAnalysisStatus(contractId: string): Promise<AnalysisStatus | null>`. Latest analysis job; `queued→Queued`, etc.; `error = last_error` only when `Failed`; `findingCount` = count of findings.
    - `submitPoc(record: { poc: PoCSubmission; job: NewJob; findingId: string; now: string }): Promise<"ok" | "not_flagged">`. One transaction: `UPDATE findings SET status='Submitted', status_history = status_history || $entry WHERE id=$1 AND status='Flagged'`. Zero rows → rollback, `"not_flagged"`. Otherwise insert the PoC and the job.
  - `MemoryPipelineRepository` and `PgPipelineRepository` implement it. The memory version exposes `seedFinding(row)` for tests.

- [ ] **Step 1: Write the migration** exactly as spec §4, using `IF NOT EXISTS` everywhere (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- [ ] **Step 2: Write failing tests.** The same suite runs against both implementations via a shared `describeRepository(factory)` helper; the pg variant is `describe.skipIf(!DATABASE_URL)`. Tests:
  - `insertContract also queues an analysis job`: `getAnalysisStatus` → `Queued`, `findingCount` 0.
  - `claim succeeds once, second claim is not_open`.
  - `expired claim can be re-claimed and reads back as Open`.
  - `concurrent claims: exactly one ok` (pg only; `Promise.all` of 2 claims).
  - `listQueue includes Open and expired-Claimed, excludes active Claimed`, with bounty joined.
  - `listFindings orders High before Low and fills the active claim`.
  - `submitPoc on Flagged finding → ok, finding Submitted with 2 history entries, sandbox job queued`.
  - `submitPoc twice → second returns not_flagged and writes nothing`.
  - `getAnalysisStatus Failed exposes last_error`. Seed by updating the job row directly in pg; via a helper in memory.
- [ ] **Step 3: Run** `docker compose up -d db` (needs Docker WSL integration), then `DATABASE_URL=postgres://bbm:bbm@localhost:5432/bbm pnpm --filter @bbm/api test`. Expected: FAIL.
- [ ] **Step 4: Implement** both repositories. Row→`Finding` mapping lives in one function `toFinding(row, claim)` in `pipeline/pg-repository.ts`. Update `contracts/service.ts` so `submitContract` builds the `analysisJob` (`job_<uuid>`, kind `analysis`, subject = contract id).
- [ ] **Step 5: Run** `pnpm --filter @bbm/api lint && pnpm --filter @bbm/api typecheck && DATABASE_URL=… pnpm --filter @bbm/api test`. Expected: PASS, pg suites not skipped.
- [ ] **Step 6: Commit** `feat(api): add findings, PoC and job tables with repositories`.

### Task 7: Pipeline routes

**Files:**
- Create: `apps/api/src/pipeline/config.ts`, `apps/api/src/pipeline/routes.ts`, `apps/api/src/pipeline/routes.test.ts`
- Modify: `apps/api/src/app.ts` (an `AppOptions.pipeline?: PipelineRepository` and `AppOptions.config?: PipelineConfig`; register routes), `apps/api/src/index.ts` (wire `PgPipelineRepository` when `DATABASE_URL` is set), `apps/api/src/contracts/routes.ts` (add `GET /api/contracts`), `docs/api.md` (routes + env table)

**Interfaces:**
- Consumes: Task 6 repositories; Task 5 schemas.
- Produces:
  - `PipelineConfig = { claimWindowSeconds: number; challengeWindowSeconds: number; jobMaxAttempts: number; now: () => Date }`
  - `loadPipelineConfig(env = process.env): PipelineConfig`
  - Routes exactly as in spec §5, with these status codes and `{ error }` messages:
    - `"auditorId is required"` / `"contractId and auditorId are required"` (400)
    - `"Contract … is not open to claim"` (409)
    - `"You do not hold an active claim on this contract"` (403)
    - `"Finding is not Flagged"` (409)
    - `"PoC file exceeds the 100 KB limit"` (413)
    - `"Not found"` (404)

- [ ] **Step 1: Write failing route tests** with `app.inject`, memory repos, and an injected `now`:
  - `GET /api/contracts?developerAddress=bad` → 400; valid → only that developer's contracts.
  - `GET /api/contracts/:id/findings` → 404 unknown; seeded findings → array that parses with `z.array(FindingSchema)`.
  - `GET /api/contracts/:id/analysis` → `Queued` right after `POST /api/contracts`.
  - `GET /api/findings/:id/raw` → the seeded raw JSON; unknown → 404.
  - `GET /api/auditor/queue?sort=bounty` sorted by amount descending; `sort=bad` → 400.
  - `POST /api/auditor/claim`: 200, then 409 for a second auditor, then 200 after `now` passes `claimWindowSeconds`.
  - `POST /api/auditor/poc` happy path → 201, parses with `PoCSubmissionSchema`, `sandboxStatus:"Pending"`, the stored file key matches `pocs/<pocId>/<sha256>.t.sol`, finding now `Submitted`.
  - PoC with a `.sol` name → 400; 102_401 bytes → 413; unknown finding → 404; no claim → 403; claim expired → 403; finding already Submitted → 409.
- [ ] **Step 2: Run** `pnpm --filter @bbm/api test`. Expected: FAIL.
- [ ] **Step 3: Implement** `registerPipelineRoutes(app, deps)`. Reuse `CONTRACT_MULTIPART_LIMITS` with `fileSize: POC_SOURCE_MAX_BYTES`, and parse multipart the same way `contracts/routes.ts` does. Extract that loop into a shared `readMultipart(request)` helper in `apps/api/src/http/multipart.ts` and use it from both routes.
- [ ] **Step 4: Run** `pnpm --filter @bbm/api lint && pnpm --filter @bbm/api typecheck && pnpm --filter @bbm/api test && pnpm --filter @bbm/api build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): add findings, analysis status, queue, claim and PoC routes`.
- [ ] **Step 6: Open PR B, then CI, review and merge** exactly as Task 4 Steps 6–7. In the PR body, note for Pranav and Hein that it touches `apps/api` and `packages/shared`, additive only.

---

## PR C — `feat/analysis-worker-jobs` (Tue 10/21)

### Task 8: Job queue client

**Files:** Create `workers/analysis/src/bbm_analysis/db.py`, `workers/analysis/src/bbm_analysis/jobs.py`, `workers/analysis/tests/conftest.py`, `workers/analysis/tests/test_jobs.py`

**Interfaces:**
- Produces:
  - `db.connect(database_url: str) -> psycopg.Connection` with `row_factory=dict_row` and autocommit off.
  - `@dataclass(frozen=True) Job(id: str, kind: Literal["analysis","sandbox"], subject_id: str, attempts: int)`
  - `claim_next(conn, lease_s: int, max_attempts: int) -> Job | None`. Uses the spec §6.1 SQL and commits.
  - `complete(conn, job_id: str) -> None`. Sets `done`. Does **not** commit; the caller commits together with its result writes.
  - `fail(conn, job: Job, reason: str, retryable: bool, max_attempts: int) -> None`. Sets `queued` if `retryable and job.attempts < max_attempts`, otherwise `failed`. Sets `last_error=reason` and commits.
  - `expire_exhausted(conn, max_attempts: int) -> int`. Marks expired-lease jobs with `attempts >= max` as `failed` with `last_error="Lease expired after max attempts"`.
  - conftest fixture `pg_conn`. Skips when `DATABASE_URL` is unset. Applies every `apps/api/src/db/migrations/*.sql` in order, yields a connection, and truncates `jobs, poc_submissions, findings, contracts, bounties` afterwards.
  - conftest helper `insert_contract(conn, source: bytes, storage_dir: Path, filename="Vault.sol") -> str`. Writes the file at `contracts/<id>/<sha>.sol` and returns the contract id.

- [ ] **Step 1: Write failing tests:**
  - `claim_next` returns the oldest queued job and sets `running` with `attempts == 1`.
  - Two connections claiming at the same time get different jobs.
  - A running job with an expired lease is re-claimed.
  - `fail(retryable=True)` with attempts < max → `queued`; at max → `failed`.
  - `expire_exhausted` marks exhausted jobs `failed`.
  - No jobs → `None`.
- [ ] **Step 2: Run** `DATABASE_URL=… uv run pytest tests/test_jobs.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(workers): add Postgres job queue client`.

### Task 9: LLM explainer

**Files:** Create `workers/analysis/src/bbm_analysis/llm.py`, `workers/analysis/tests/test_llm.py`

**Interfaces:**
- Consumes: `DetectorResult` (Task 3), `Settings` (Task 1).
- Produces:
  - `MAX_LLM_FINDINGS = 50`
  - `class Explainer(Protocol): def explain(self, source: str, detectors: Sequence[DetectorResult]) -> dict[int, str]`
  - `OpenAICompatibleExplainer(settings: Settings, http_client: httpx.Client | None = None)`
    - one chat-completions call;
    - `response_format={"type":"json_object"}`, timeout 30 s, `max_retries=1`;
    - sends only the first `MAX_LLM_FINDINGS` detectors;
    - returns `{index: explanation}` for valid, non-empty entries;
    - raises nothing; returns `{}` on any error.
  - `NullExplainer`: always `{}`. Used when `not settings.llm_configured`.
  - `make_explainer(settings) -> Explainer`
  - `explanations_for(detectors, explained: dict[int, str]) -> list[tuple[str, Literal["llm","slither"]]]`. Fallback text = `detector.description.strip()`.

- [ ] **Step 1: Write failing tests** using `httpx.MockTransport` handlers passed as `http_client`. No network.
  - `test_happy_path`: the transport asserts that the request body contains the full source and `"reentrancy-eth"`. It returns `{"explanations":[{"index":0,"explanation":"Funds can be drained…"}]}` → `{0: "Funds can be drained…"}`.
  - `test_timeout_returns_empty`: the transport raises `httpx.ReadTimeout` → `{}`.
  - `test_bad_json_returns_empty`: the content is `"not json"` → `{}`.
  - `test_partial_and_blank_entries_dropped`: entries for indexes 0 (blank) and 1 (valid) → `{1: …}`.
  - `test_unknown_index_ignored`: index 99 is dropped.
  - `test_caps_at_50`: 120 detectors → the request lists exactly 50 findings.
  - `test_explanations_for_falls_back`: `explained={0:"x"}` with 2 detectors → `[("x","llm"), (d1.description,"slither")]`.
  - `test_make_explainer_without_key_is_null`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The client is `openai.OpenAI(base_url=settings.llm_endpoint, api_key=settings.llm_api_key, http_client=http_client, timeout=30, max_retries=1)` and calls `chat.completions.create(model=settings.llm_model, …)`.
  - System prompt: "You explain Slither findings to the contract's developer. Your output is advisory only. For each finding write at most 120 words in plain English: what is wrong, how it could be exploited, how to fix it. Reply with JSON only: {\"explanations\":[{\"index\":<int>,\"explanation\":<string>}]}".
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(workers): add LLM explainer with Slither-text fallback`.

### Task 10: Analysis job handler and worker loop

**Files:** Create `workers/analysis/src/bbm_analysis/storage.py`, `workers/analysis/src/bbm_analysis/analysis_job.py`, `workers/analysis/src/bbm_analysis/main.py`, `workers/analysis/tests/test_analysis_job.py`, `workers/analysis/tests/test_main.py`

**Interfaces:**
- Consumes: Tasks 2, 3, 8, 9.
- Produces:
  - `storage.read_source(storage_dir: Path, key: str) -> bytes`. Refuses keys that escape the root, mirroring the API's `LocalSourceStorage`.
  - `@dataclass(frozen=True) JobOutcome(ok: bool, reason: str | None = None, retryable: bool = False)`
  - `run_analysis_job(conn, job: Job, settings: Settings, explainer: Explainer, slither=run_slither) -> JobOutcome`
    - On success it writes findings and calls `complete` in one transaction.
    - The caller calls `fail` when `ok` is false.
    - Each finding row is validated with `bbm_analysis.models.Finding` before insert.
  - `handle(job, settings, explainer) -> None`. Opens its own connection and dispatches on `job.kind` (`"sandbox"` → Task 12's `run_sandbox_job`; until then it raises `NotImplementedError`, which is turned into a non-retryable fail). Any unexpected exception becomes a retryable fail with the exception text.
  - `main() -> None`. `Settings.from_env()` (also loads `.env` via a tiny parser; no extra dependency). Loop: `expire_exhausted`, then `claim_next`; submit to a `ThreadPoolExecutor(settings.worker_concurrency)`; when nothing is claimed or all slots are busy, sleep `poll_interval_s`. Stops cleanly on SIGINT/SIGTERM.

- [ ] **Step 1: Write failing tests** with `pg_conn`, a `tmp_path` storage dir, a fake `slither` returning the `vault-slither.json` fixture, and a fake explainer:
  - `test_vault_creates_flagged_findings`: every row has `status='Flagged'`, one history entry, `raw_output_reference == f"/api/findings/{id}/raw"`, `explanation_source` `llm` for explained indexes and `slither` otherwise. The job is `done`.
  - `test_hash_mismatch_fails_without_retry`: the file bytes differ from `source_hash` → `JobOutcome(ok=False, retryable=False)` with reason starting `"Source hash mismatch"`.
  - `test_unsupported_pragma_fails_without_retry`: reason `"Unsupported Solidity version: ^0.6.0"`.
  - `test_slither_error_fails_without_retry`: reason = the `SlitherError` message.
  - `test_zero_findings_is_done`.
  - `test_llm_failure_still_creates_findings`: the explainer returns `{}` → every `explanation_source='slither'`.
  - `test_main_handle_turns_exception_into_retryable_fail` (`test_main.py`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `uv run ruff check . && DATABASE_URL=… uv run pytest -q`. Expected: PASS.
- [ ] **Step 5: Manual smoke with the real key** (James puts `LLM_*` in `workers/analysis/.env`):
  1. `docker compose up -d db`.
  2. Run the API with `DATABASE_URL` and `SOURCE_STORAGE_DIR=$PWD/.data/storage`.
  3. Run the worker with the same values: `uv run bbm-analysis`.
  4. `curl -F file=@workers/analysis/tests/fixtures/Vault.sol -F developerAddress=0x1234567890123456789012345678901234567890 -F bountyAmount=1 -F deadline=2030-01-01T00:00:00.000Z localhost:3001/api/contracts`
  5. Poll `/api/contracts/<id>/analysis` until `Done`.
  6. `/findings` shows `reentrancy-eth` with an LLM explanation.

  If the endpoint format is wrong, fix `base_url` handling (e.g. append `/openai/v1`) and add a config test for it. Record the working `LLM_ENDPOINT` format in `.env.example` (format only, no secrets).
- [ ] **Step 6: Commit** `feat(workers): run analysis jobs end to end`. Then open PR C, CI, review and merge as in Task 4.

---

## PR D — `feat/poc-sandbox` (Wed 10/22)

### Task 11: Sandbox image

**Files:** Create `workers/sandbox/Dockerfile`, `workers/sandbox/README.md`, `workers/sandbox/smoke/foundry.toml`, `workers/sandbox/smoke/src/Smoke.sol`, `workers/sandbox/smoke/test/Smoke.t.sol`

**Interfaces:**
- Produces:
  - Image `bbm-sandbox:latest`, user `1000:1000`, `forge` on `PATH`.
  - `forge-std` at `/opt/forge-std`, at the commit pinned by `contracts/lib/forge-std` (`f3dae6e6ee381f25eb6a246f7da9b85c91a68219`).
  - Every version in `workers/solc-versions.txt` is installed where forge finds it offline (`$HOME/.svm/<v>/solc-<v>` for user 1000).

- [ ] **Step 1: Write the Dockerfile.**
  - Base: `debian:bookworm-slim`.
  - Install Foundry with `foundryup --install <pinned stable version>`; pin the version you install and record it in the README.
  - Copy `workers/solc-versions.txt` and, for each version, download the static Linux `solc` from `binaries.soliditylang.org` into the svm path, checking its sha256 from that site's `list.json`.
  - Clone `forge-std` at the pinned commit into `/opt/forge-std`.
  - `USER 1000`. Build context is `workers/` so `solc-versions.txt` is reachable.
- [ ] **Step 2: Build** `docker build -f workers/sandbox/Dockerfile -t bbm-sandbox:latest workers`. Expected: success.
- [ ] **Step 3: Offline smoke check.** `tar -C workers/sandbox/smoke -c . | docker run --rm -i --network none --read-only --tmpfs /tmp:rw,exec,size=256m --user 1000:1000 bbm-sandbox:latest sh -c 'mkdir -p /tmp/w && tar -x -C /tmp/w && cd /tmp/w && forge test -vvv'`. Expected: `1 passed; 0 failed`. If forge tries to download solc or write to `$HOME`, set `solc = "/home/sandbox/.svm/<v>/solc-<v>"` explicitly in the generated `foundry.toml` (Task 12) and/or set `FOUNDRY_CACHE_PATH=/tmp/w/cache`, then re-run.
- [ ] **Step 4: Commit** `feat(workers): add offline Foundry sandbox image`.

### Task 12: Sandbox runner and sandbox job

**Files:** Create `workers/analysis/src/bbm_analysis/sandbox.py`, `workers/analysis/src/bbm_analysis/sandbox_job.py`, `workers/analysis/tests/test_sandbox.py`, `workers/analysis/tests/test_sandbox_job.py`, `workers/analysis/tests/fixtures/pocs/PoC_pass.t.sol`, `PoC_fail.t.sol`, `PoC_hang.t.sol`, `PoC_network.t.sol`
- Modify: `workers/analysis/src/bbm_analysis/main.py` (dispatch `sandbox` → `run_sandbox_job`)

**Interfaces:**
- Consumes: `pick_solc`, `safe_filename`, `Job`/`complete`/`fail`, `read_source`, `JobOutcome`.
- Produces:
  - `LOG_LIMIT_BYTES = 65_536`
  - `build_tarball(target_filename: str, target_source: bytes, poc_source: bytes, solc_version: str) -> bytes`. Contains `foundry.toml` (spec §6.4 settings + `solc_version`), `src/<safe_filename>` and `test/PoC.t.sol`.
  - `@dataclass(frozen=True) SandboxResult(status: Literal["Passed","Failed"] | None, log: str, infra_error: str | None)`. `status is None` exactly when `infra_error` is set.
  - `docker_command(poc_id: str, settings: Settings) -> list[str]`, exactly the spec §6.4 flags.
  - `run_poc(tar: bytes, poc_id: str, settings: Settings, run=subprocess.run) -> SandboxResult`
  - `forge_passed(output: str) -> bool`. True iff some `Suite result: ok. N passed; 0 failed` line has N ≥ 1 and no line reports `failed` > 0.
  - `truncate_log(text: str) -> str`. Keeps the last `LOG_LIMIT_BYTES` bytes and prefixes `"[truncated]\n"` when it cuts.
  - `run_sandbox_job(conn, job: Job, settings: Settings, runner=run_poc) -> JobOutcome`. Writes are as in spec §6.4 step 6. An infra error → `JobOutcome(ok=False, reason=infra_error, retryable=True)` and the finding is left `Submitted`.

- [ ] **Step 1: Write the fixture PoCs.** Each imports `../src/Vault.sol` and `forge-std/Test.sol`.
  - pass: deposits as a victim, re-enters from an attacker contract, and asserts the attacker drained the balance;
  - fail: asserts `false` after a normal withdraw;
  - hang: `while (true) {}` with `vm.pauseGasMetering()`;
  - network: calls `vm.ffi(["curl","https://example.com"])`. FFI is disabled, so it fails.
- [ ] **Step 2: Write failing unit tests** (fake `run`):
  - `test_docker_command_flags`: includes `--network none --memory 1g --cpus 1 --pids-limit 256 --read-only --cap-drop ALL --security-opt no-new-privileges --user 1000:1000 --rm -i --name bbm-sandbox-poc_1`.
  - `test_tarball_layout_and_safe_name`: target `"../../Vault.sol"` → members `foundry.toml`, `src/Vault.sol`, `test/PoC.t.sol`; no member contains `..`; `foundry.toml` contains `offline = true` and `solc_version = "0.8.28"`.
  - `test_pass_output` / `test_fail_output` / `test_zero_tests_is_fail` (`"No tests found"` with exit 0 → Failed).
  - `test_timeout_kills_container`: the fake raises `TimeoutExpired`, and the next call is `["docker","kill","bbm-sandbox-poc_1"]` → `Failed`, log `"Timed out after 120s"`.
  - `test_docker_missing_is_infra_error`: `FileNotFoundError` → `infra_error`.
  - `test_daemon_down_is_infra_error`: exit 125 with `"Cannot connect to the Docker daemon"` → `infra_error`.
  - `test_huge_output_truncated_but_verdict_from_full_output`: 1 MB of noise followed by a pass summary → `Passed`, `len(log.encode()) <= 65_536 + 12`.
- [ ] **Step 3: Write failing job tests** (`pg_conn`, fake runner):
  - Passed → PoC `Passed`, finding `Verified`, `challenge_window_expires_at ≈ now + 86400s`, history length 3, job `done`.
  - Failed → `Rejected`.
  - infra error → finding still `Submitted`, outcome retryable.
  - The PoC file is read from `pocs/<pocId>/<sha>.t.sol`.
  - Add `CHALLENGE_WINDOW_SECONDS` (default 86400) to `Settings` and its test.
- [ ] **Step 4: Write Docker integration tests** (`@pytest.mark.docker`, real `run_poc` against the built image):
  - pass → `Passed`
  - fail → `Failed`
  - hang with `sandbox_timeout_s=20` → `Failed` and `"Timed out"`
  - network → `Failed`
- [ ] **Step 5: Run** `uv run pytest -q` (expect FAIL), then implement, then `uv run pytest -q && uv run pytest -m docker -q`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(workers): run PoCs in the Docker sandbox and record verdicts`.

### Task 13: CI `sandbox` job, then open PR D

**Files:** Modify `.github/workflows/ci.yml`, `README.md`

- [ ] **Step 1: Add a `sandbox` filter** with paths `workers/sandbox/**`, `workers/solc-versions.txt`, `workers/analysis/src/bbm_analysis/sandbox.py`.
- [ ] **Step 2: Add a `sandbox` job.** Steps:
  1. `docker build -f workers/sandbox/Dockerfile -t bbm-sandbox:latest workers`
  2. setup-uv
  3. `cd workers/analysis && uv sync --frozen && uv run pytest -m docker -q`

  Add it to `ci-ok`.
- [ ] **Step 3: Validate the YAML**, then commit `ci: add path-filtered sandbox job`. Open PR D, CI, review and merge as in Task 4.

---

## PR E — `feat/web-live-pipeline` (Thu 10/23)

### Task 14: Web live-pipeline mode

**Files:**
- Create: `apps/web/src/mocks/handlers/live.ts`, `apps/web/src/mocks/handlers/live.test.ts`
- Modify: `apps/web/src/mocks/handlers/index.ts`, `apps/web/next.config.ts`, `apps/web/src/lib/api/developer.ts` (add `getAnalysisStatus`), `apps/web/src/app/contracts/_components/FindingCard.tsx` (link raw output), `apps/web/src/app/contracts/[id]/page.tsx` (show the analysis error), `apps/web/src/mocks/handlers/developer.ts` (mock `GET /api/contracts/:id/analysis` so mocked mode keeps working)

**Interfaces:**
- Produces:
  - `LIVE_ROUTES: ReadonlyArray<{ method: "GET" | "POST"; path: string }>`, exactly the spec §7 list.
  - `selectHandlers(all: RequestHandler[], live: boolean): RequestHandler[]` drops handlers whose `info.method`+`info.path` (minus the `*` prefix) are in `LIVE_ROUTES`.
  - `handlers` = `selectHandlers([...], process.env.NEXT_PUBLIC_LIVE_PIPELINE === "enabled")`.
  - `getAnalysisStatus(contractId): Promise<AnalysisStatus>`.

- [ ] **Step 1: Write failing tests:**
  - `selectHandlers(handlers, false)` returns all handlers.
  - `selectHandlers(handlers, true)` removes exactly 8 entries, and the remaining set still contains `POST */api/auditor/stake` and `GET */api/arbiter/disputes`.
  - The mocked `GET /api/contracts/:id/analysis` returns a schema-valid `AnalysisStatus`.
  - `FindingCard` renders an `<a href="/api/findings/f1/raw">` when the reference starts with `/api/`, and plain text otherwise.
- [ ] **Step 2: Run** `pnpm --filter @bbm/web test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `next.config.ts`: `async rewrites() { return process.env.NEXT_PUBLIC_LIVE_PIPELINE === "enabled" ? [{ source: "/api/:path*", destination: `${process.env.API_URL ?? "http://localhost:3001"}/api/:path*` }] : []; }`
  - The contract page polls `getAnalysisStatus` with the findings query and shows `Analysis failed: <error>` when `status === "Failed"`.
- [ ] **Step 4: Run** `pnpm --filter @bbm/web lint && pnpm --filter @bbm/web typecheck && pnpm --filter @bbm/web test && pnpm --filter @bbm/web build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): add live pipeline mode proxying analysis routes to the API`.

### Task 15: Compose, demo script, docs, rehearsal; open PR E

**Files:** Modify `docker-compose.yml`, `README.md`, `docs/workers.md`, `docs/api.md`; Create `scripts/demo-pipeline.sh`, `apps/api/Dockerfile`

- [ ] **Step 1: Add compose services.**
  - `api`: build `apps/api/Dockerfile` (Node 20, pnpm, `pnpm --filter @bbm/api build`, run `node dist/index.js`), with `DATABASE_URL` and `SOURCE_STORAGE_DIR=/data/storage`.
  - `worker`: build `workers/analysis/Dockerfile`, with the same env, `env_file: workers/analysis/.env` (`required: false`), and `/var/run/docker.sock` mounted.
  - A shared named volume `storage` mounted at `/data/storage` in both.
  - Uncomment nothing else.
- [ ] **Step 2: Write `scripts/demo-pipeline.sh`** (bash, `set -euo pipefail`, needs `curl` and `jq`, `API=${API:-http://localhost:3001}`). It:
  1. submits `Vault.sol` and polls `/analysis` until `Done` (fails on `Failed` or after 180 s);
  2. prints findings (severity, detector, first 100 chars of the explanation);
  3. claims as `auditor_1`;
  4. submits `PoC_pass.t.sol` against the `reentrancy-eth` finding and polls findings until it is `Verified`;
  5. submits `PoC_fail.t.sol` against another finding (if any) and expects `Rejected`;
  6. prints `DEMO OK`.
- [ ] **Step 3: Rehearse.**
  1. `docker build -f workers/sandbox/Dockerfile -t bbm-sandbox:latest workers && docker compose up -d --build db api worker && ./scripts/demo-pipeline.sh`. Expected: `DEMO OK`.
  2. Then run the web with `NEXT_PUBLIC_API_MOCKING=enabled NEXT_PUBLIC_LIVE_PIPELINE=enabled pnpm --filter @bbm/web dev` and click through: submit `Vault.sol` → findings appear → switch to auditor → claim → stake (mocked) → upload `PoC_pass.t.sol` → `Verified`.
  3. Capture any defects as fixes on this branch.
- [ ] **Step 4: Update docs.** README: a "Running the live analysis pipeline" section (prerequisites: Docker with WSL integration, and the `.env` keys), the exact commands from Step 3, and the PoC import convention `import "../src/<filename>";`. Update `docs/workers.md` and `docs/api.md`.
- [ ] **Step 5: Commit** `feat: add compose services and demo script for the live pipeline`. Open PR E; the body tags the `apps/web` changes for Joshua. Then CI, review and merge as in Task 4.

---

## Friday 10/24

### Task 16: Milestone 3 write-up rows

- [ ] **Step 1:** From the merged code, draft James's content for the Milestone 3 doc: MVP feature rows, Design Changes (spec §12), Test Plan rows (one per test file/marker, with Passing/Planned status taken from the last CI run), Known Issues (spec §11), and How to Run (README section). Present it in chat for James to paste. Do not edit the shared Google Doc unless James asks.
