"""HTTP entrypoint for the analysis worker.

Only a skeleton for now: `/health` is live and `/analyze` is a stub that
returns 501 until the Slither + LLM pipeline lands.
"""

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from analysis import __version__

app = FastAPI(title="bbm-analysis", version=__version__)


class AnalyzeRequest(BaseModel):
    """Request body for `POST /analyze`."""

    model_config = ConfigDict(extra="forbid")

    contractId: str = Field(min_length=1)  # camelCase matches the shared schemas
    source: str = Field(min_length=1)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze", status_code=501)
def analyze(request: AnalyzeRequest) -> JSONResponse:
    # TODO(analysis-pipeline): replace this stub with the real flow:
    #   1. Write `request.source` to an isolated temp dir and run Slither in a
    #      sandbox (no network, CPU/memory/time limits, pinned solc via
    #      solc-select).
    #   2. Map each Slither detector result to the shared `Finding` schema
    #      (analysis.generated.models.Finding): severity from Slither impact,
    #      `slitherDetector` = detector id, `rawOutputReference` = pointer to the
    #      stored raw JSON output, initial status `Flagged`.
    #   3. Ask an LLM for a plain-English `llmExplanation` per finding. This is
    #      advisory only: it must never change a finding's status or payout.
    del request
    return JSONResponse(
        status_code=501,
        content={"detail": "not implemented: slither + LLM pipeline lands in a later branch"},
    )
