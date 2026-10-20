"""Runs Slither on a single Solidity source file."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from .paths import slither_filename

_STDERR_TAIL_CHARS = 2000


class SlitherError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


_SOLC_FAILURE = "Invalid solc compilation "


def _failure_message(output: str) -> str:
    """What to show the developer when Slither crashes without a report.

    For a compile error that is solc's own message (with file, line and
    column). For anything else it is the exception's last line, never the
    traceback, which would leak worker paths.
    """
    if _SOLC_FAILURE in output:
        return output.rsplit(_SOLC_FAILURE, 1)[1].strip()[:_STDERR_TAIL_CHARS]
    lines = [line for line in output.strip().splitlines() if line.strip()]
    return lines[-1].strip()[:_STDERR_TAIL_CHARS] if lines else ""


def _slither_binary() -> str:
    """The `slither` installed with this worker, even when its venv's bin/ is
    not on PATH (e.g. the console script was started directly)."""
    sibling = Path(sys.executable).parent / "slither"
    return str(sibling) if sibling.exists() else "slither"


def run_slither(
    source: bytes, filename: str, solc_version: str, timeout_s: int = 120
) -> dict[str, Any]:
    """Runs Slither and returns its parsed JSON report.

    Slither exits non-zero whenever it finds issues, so success is read from the
    report's `success` field, never from the exit code. Raises SlitherError on a
    compile failure, a timeout, or a missing report.
    """
    with tempfile.TemporaryDirectory(prefix="bbm-slither-") as tmp:
        target = Path(tmp) / slither_filename(filename)
        target.write_bytes(source)
        out = Path(tmp) / "out.json"
        # slither and the solc-select `solc` shim live next to this Python;
        # put them first on PATH even if the venv was never activated.
        bin_dir = str(Path(sys.executable).parent)
        path = os.pathsep.join([bin_dir, os.environ.get("PATH", "")])
        env = {**os.environ, "PATH": path, "SOLC_VERSION": solc_version}
        if sys.prefix != sys.base_prefix:
            # solc-select keeps its compilers under $VIRTUAL_ENV/.solc-select.
            env["VIRTUAL_ENV"] = sys.prefix
        try:
            proc = subprocess.run(
                [_slither_binary(), str(target), "--json", str(out)],
                cwd=tmp,
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout_s,
            )
        except subprocess.TimeoutExpired:
            raise SlitherError(f"Slither timed out after {timeout_s}s") from None

        if not out.exists():
            raise SlitherError(
                _failure_message(proc.stderr or proc.stdout or "")
                or f"Slither produced no report (exit {proc.returncode})"
            )
        report = json.loads(out.read_text(encoding="utf-8"))

    if not report.get("success"):
        raise SlitherError(report.get("error") or "Slither failed without an error message")
    return report
