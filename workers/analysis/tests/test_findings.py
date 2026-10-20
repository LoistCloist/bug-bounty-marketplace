import json
from pathlib import Path

import pytest

from analysis.findings import DetectorResult, parse_detectors, severity_for
from analysis.paths import safe_filename

FIXTURES = Path(__file__).parent / "fixtures"


def _result(check: str, impact: str) -> dict:
    return {
        "check": check,
        "impact": impact,
        "confidence": "High",
        "description": f"{check} description\n",
        "elements": [],
    }


def test_parse_vault_fixture_has_reentrancy():
    data = json.loads((FIXTURES / "vault-slither.json").read_text())
    results = parse_detectors(data)
    reentrancy = [r for r in results if r.check == "reentrancy-eth"]
    assert len(reentrancy) == 1
    assert severity_for(reentrancy[0].impact) == "High"
    assert reentrancy[0].raw["check"] == "reentrancy-eth"
    assert [r.index for r in results] == list(range(len(results)))


def test_parse_drops_optimization():
    data = {
        "success": True,
        "results": {"detectors": [_result("cache-array", "Optimization"), _result("x", "Low")]},
    }
    assert parse_detectors(data) == [
        DetectorResult(
            index=0,
            check="x",
            impact="Low",
            confidence="High",
            description="x description\n",
            raw=_result("x", "Low"),
        )
    ]


def test_parse_empty_results():
    assert parse_detectors({"success": True, "results": {}}) == []


@pytest.mark.parametrize(
    ("impact", "severity"),
    [("High", "High"), ("Medium", "Medium"), ("Low", "Low"), ("Informational", "Informational")],
)
def test_severity_for_maps_one_to_one(impact, severity):
    assert severity_for(impact) == severity


def test_severity_for_unknown_raises():
    with pytest.raises(ValueError):
        severity_for("Optimization")


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("../../evil.sol", "evil.sol"),
        ("My Vault.sol", "My Vault.sol"),
        ("Vault (1).sol", "Vault (1).sol"),
        ("x.txt", "Contract.sol"),
        ("..", "Contract.sol"),
        ("C:\\\\dir\\\\Token.sol", "Token.sol"),
        ("Vault.SOL", "Vault.SOL"),
        ("a\x00b\x1f.sol", "ab.sol"),
        ("..hidden.sol", "hidden.sol"),
        ("  .sol", "Contract.sol"),
    ],
)
def test_safe_filename(name, expected):
    assert safe_filename(name) == expected


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Vault.sol", "Vault.sol"),
        ("My Vault.sol", "My Vault.sol"),
        ("Vault.SOL", "Vault.sol"),
        ("x=y.sol", "x_y.sol"),
        ("../a=b.Sol", "a_b.sol"),
    ],
)
def test_slither_filename_is_one_crytic_compile_and_solc_accept(name, expected):
    from analysis.paths import slither_filename

    assert slither_filename(name) == expected
