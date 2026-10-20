import json
import subprocess
from pathlib import Path

import pytest

from analysis import slither_runner
from analysis.findings import parse_detectors
from analysis.slither_runner import SlitherError, run_slither

FIXTURES = Path(__file__).parent / "fixtures"


def _fake_run(payload: dict | None, stderr: str = "", calls: list | None = None):
    def run(cmd, **kwargs):
        if calls is not None:
            calls.append((cmd, kwargs))
        out = Path(cmd[cmd.index("--json") + 1])
        if payload is not None:
            out.write_text(json.dumps(payload))
        return subprocess.CompletedProcess(cmd, 255, stdout="", stderr=stderr)

    return run


def test_run_slither_returns_json_and_passes_solc_version(monkeypatch):
    calls: list = []
    payload = {"success": True, "error": None, "results": {}}
    monkeypatch.setattr(slither_runner.subprocess, "run", _fake_run(payload, calls=calls))
    assert run_slither(b"contract A {}", "../A.sol", "0.8.20") == payload
    cmd, kwargs = calls[0]
    assert Path(cmd[1]).name == "A.sol"
    assert kwargs["env"]["SOLC_VERSION"] == "0.8.20"
    assert kwargs["timeout"] == 120


def test_run_slither_reports_error_field(monkeypatch):
    payload = {"success": False, "error": "ParserError: x", "results": {}}
    monkeypatch.setattr(slither_runner.subprocess, "run", _fake_run(payload))
    with pytest.raises(SlitherError) as exc:
        run_slither(b"contract A {", "A.sol", "0.8.28")
    assert exc.value.message == "ParserError: x"


def test_run_slither_missing_json_uses_stderr_tail(monkeypatch):
    monkeypatch.setattr(
        slither_runner.subprocess, "run", _fake_run(None, stderr="boom\nsolc crashed")
    )
    with pytest.raises(SlitherError) as exc:
        run_slither(b"contract A {}", "A.sol", "0.8.28")
    assert "solc crashed" in exc.value.message


def test_run_slither_timeout(monkeypatch):
    def run(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, kwargs["timeout"])

    monkeypatch.setattr(slither_runner.subprocess, "run", run)
    with pytest.raises(SlitherError) as exc:
        run_slither(b"contract A {}", "A.sol", "0.8.28")
    assert exc.value.message == "Slither timed out after 120s"


@pytest.mark.slither
def test_real_slither_on_vault():
    source = (FIXTURES / "Vault.sol").read_bytes()
    checks = {r.check for r in parse_detectors(run_slither(source, "Vault.sol", "0.8.28"))}
    assert "reentrancy-eth" in checks


@pytest.mark.slither
def test_real_slither_compile_error():
    with pytest.raises(SlitherError) as exc:
        run_slither(b"pragma solidity ^0.8.19;\ncontract Broken {", "Broken.sol", "0.8.28")
    assert exc.value.message.startswith("Error:")
    assert "Traceback" not in exc.value.message


COMPILE_FAILURE_STDERR = """Traceback (most recent call last):
  File "/venv/lib/python3.12/site-packages/slither/__main__.py", line 936, in main_impl
    raise InvalidCompilation(f"Invalid solc compilation {stderr}")
crytic_compile.platform.exceptions.InvalidCompilation: Invalid solc compilation Error: Expected type name
 --> Broken.sol:3:15:
  |
3 |   function f( {
  |               ^
"""


def test_compile_failure_reports_the_solc_error_only(monkeypatch):
    monkeypatch.setattr(
        slither_runner.subprocess, "run", _fake_run(None, stderr=COMPILE_FAILURE_STDERR)
    )
    with pytest.raises(SlitherError) as exc:
        run_slither(b"contract Broken {", "Broken.sol", "0.8.28")
    assert exc.value.message.startswith("Error: Expected type name\n --> Broken.sol:3:15:")
    assert "Traceback" not in exc.value.message
    assert "site-packages" not in exc.value.message


def test_other_crash_reports_the_last_line_only(monkeypatch):
    stderr = (
        'Traceback (most recent call last):\n  File "/venv/x.py", line 1\nValueError: bad thing\n'
    )
    monkeypatch.setattr(slither_runner.subprocess, "run", _fake_run(None, stderr=stderr))
    with pytest.raises(SlitherError) as exc:
        run_slither(b"contract A {}", "A.sol", "0.8.28")
    assert exc.value.message == "ValueError: bad thing"


def test_uses_the_slither_installed_next_to_this_python(monkeypatch):
    import sys

    calls: list = []
    monkeypatch.setenv("PATH", "/nonexistent")
    payload = {"success": True, "error": None, "results": {}}
    monkeypatch.setattr(slither_runner.subprocess, "run", _fake_run(payload, calls=calls))
    run_slither(b"contract A {}", "A.sol", "0.8.28")
    assert Path(calls[0][0][0]) == Path(sys.executable).parent / "slither"


def test_subprocess_path_starts_with_this_pythons_bin(monkeypatch):
    import os
    import sys

    calls: list = []
    monkeypatch.setenv("PATH", "/usr/bin")
    payload = {"success": True, "error": None, "results": {}}
    monkeypatch.setattr(slither_runner.subprocess, "run", _fake_run(payload, calls=calls))
    run_slither(b"contract A {}", "A.sol", "0.8.28")
    path = calls[0][1]["env"]["PATH"].split(os.pathsep)
    assert path[0] == str(Path(sys.executable).parent)
    assert "/usr/bin" in path


def test_subprocess_uses_this_venv_for_solc_select(monkeypatch):
    import sys

    calls: list = []
    monkeypatch.delenv("VIRTUAL_ENV", raising=False)
    payload = {"success": True, "error": None, "results": {}}
    monkeypatch.setattr(slither_runner.subprocess, "run", _fake_run(payload, calls=calls))
    run_slither(b"contract A {}", "A.sol", "0.8.28")
    assert calls[0][1]["env"]["VIRTUAL_ENV"] == sys.prefix


@pytest.mark.slither
def test_real_slither_on_a_filename_with_spaces():
    source = (FIXTURES / "Vault.sol").read_bytes()
    checks = {r.check for r in parse_detectors(run_slither(source, "My Vault.sol", "0.8.28"))}
    assert "reentrancy-eth" in checks
