"""Turns Slither's JSON output into detector results."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

_SEVERITY = {
    "High": "High",
    "Medium": "Medium",
    "Low": "Low",
    "Informational": "Informational",
}


@dataclass(frozen=True)
class DetectorResult:
    index: int
    check: str
    impact: str
    confidence: str
    description: str
    raw: dict[str, Any]


def severity_for(impact: str) -> str:
    """Maps Slither's impact to a finding severity. Slither never says Critical."""
    try:
        return _SEVERITY[impact]
    except KeyError:
        raise ValueError(f"Unknown Slither impact: {impact}") from None


def parse_detectors(slither_json: dict[str, Any]) -> list[DetectorResult]:
    """One result per detector hit, minus `Optimization` noise, numbered from 0."""
    raw_results = (slither_json.get("results") or {}).get("detectors") or []
    kept = [r for r in raw_results if r.get("impact") != "Optimization"]
    return [
        DetectorResult(
            index=i,
            check=r["check"],
            impact=r["impact"],
            confidence=r.get("confidence", ""),
            description=r.get("description", ""),
            raw=r,
        )
        for i, r in enumerate(kept)
    ]
