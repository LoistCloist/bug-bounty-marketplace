# workers/analysis

Python service that will run [Slither](https://github.com/crytic/slither)
static analysis on uploaded Solidity contracts, map detector results onto the
shared `Finding` schema, and attach a plain-English LLM explanation to each
finding. The LLM output is **advisory only** — it never changes a finding's
status or payout.

**Status: skeleton.** `GET /health` works; `POST /analyze` returns `501`.

## Develop

Requires [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 for you).

```sh
cd workers/analysis
uv sync                                   # create .venv with runtime + dev deps
uv run ruff check . && uv run ruff format --check .
uv run pytest -q                          # sockets disabled via pytest-socket
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
