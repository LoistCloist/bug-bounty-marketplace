# workers/analysis

Python service that runs [Slither](https://github.com/crytic/slither) static
analysis on uploaded Solidity contracts, maps detector results onto the shared
`Finding` schema, and attaches a plain-English LLM explanation to each finding.
The LLM output is **advisory only**: it never changes a finding's status or
payout, and if it fails each finding falls back to Slither's own text.

- `GET /health`: liveness.
- `POST /analyze` `{contractId, source}`: stateless analysis, returns the
  findings (422 with the reason for an unsupported pragma or a compile error).
- **Job poller:** when `DATABASE_URL` and `SOURCE_STORAGE_DIR` are set, a
  background thread claims jobs from the Postgres `jobs` table the API writes
  (`FOR UPDATE SKIP LOCKED`, leases, up to 3 attempts), analyses the stored
  source, and writes `Flagged` findings. Also runnable alone as
  `uv run bbm-analysis-worker`. Design:
  [analysis pipeline spec](../../docs/superpowers/specs/2026-10-19-analysis-pipeline-design.md).

The supported solc versions are listed in `src/analysis/solc-versions.txt`; the
image pre-installs them. A pragma no version satisfies fails with
`Unsupported Solidity version: <pragma>`.

| Variable | Default | Effect |
| --- | --- | --- |
| `DATABASE_URL`, `SOURCE_STORAGE_DIR` | unset | Both set: run the job poller (same Postgres and storage as the API). |
| `LLM_ENDPOINT`, `LLM_MODEL`, `LLM_API_KEY` | unset | OpenAI-compatible chat endpoint (e.g. Azure AI Foundry `https://<resource>.services.ai.azure.com/openai/v1`). Any unset: Slither text only. |
| `POLL_INTERVAL_SECONDS` | `1` | Wait between polls when the queue is empty. |
| `JOB_LEASE_SECONDS` / `JOB_MAX_ATTEMPTS` | `600` / `3` | Lease before a crashed job is retried; attempts before it fails. |
| `WORKER_CONCURRENCY` | `2` | Jobs processed at once. |

Locally, put these in `workers/analysis/.env` (git-ignored; see
`.env.example`); the service and the compose stack read it.

## Develop

Requires [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 for you).

```sh
cd workers/analysis
uv sync                                   # create .venv with runtime + dev deps
uv run ruff check . && uv run ruff format --check .
uv run pytest -q                          # sockets disabled via pytest-socket
# DB tests (job queue, analysis jobs) need Postgres; they use <db>_worker_test:
DATABASE_URL=postgres://bbm:bbm@127.0.0.1:5432/bbm uv run pytest -q
xargs -a src/analysis/solc-versions.txt -n1 uv run solc-select install
uv run pytest -m slither -q               # real Slither on the fixture contract
uv run uvicorn analysis.app:app --reload --port 8000
```

```sh
curl localhost:8000/health
curl -X POST localhost:8000/analyze -H 'content-type: application/json' \
  -d '{"contractId":"c1","source":"pragma solidity ^0.8.0;"}'
```

## Shared types

`src/analysis/generated/models.py` is generated from
`packages/shared/schema/*.json` with `datamodel-code-generator` (pydantic v2)
and committed. Do not edit it by hand; regenerate after schema changes:

```sh
uv run scripts/gen-types.sh
git diff --exit-code src/analysis/generated   # what CI checks for drift
```

## Docker

The image does **not** regenerate types (the schema directory is outside the
build context), it uses the committed `generated/models.py`.

```sh
docker build -t bbm-analysis workers/analysis
docker run --rm -p 8000:8000 bbm-analysis
```
