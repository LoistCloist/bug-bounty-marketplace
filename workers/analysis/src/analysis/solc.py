"""Chooses the solc version for a contract from its `pragma solidity` line."""

from __future__ import annotations

import re
from collections.abc import Sequence

import semantic_version

# One pass, so whichever comment starts first wins: a "/*" inside a "//"
# comment (e.g. "// see scripts/*.js") must not swallow the code after it.
_COMMENT = re.compile(r"//[^\n]*|/\*.*?\*/", re.DOTALL)
_PRAGMA = re.compile(r"pragma\s+solidity\s+([^;]+);")
# Solidity allows a space between an operator and its version (">= 0.8.0");
# npm range syntax does not.
_OPERATOR_SPACE = re.compile(r"([<>=^~]+)\s+")


class UnsupportedSolcError(Exception):
    """No supported solc version satisfies the contract's pragma."""


def _pragma_spec(source: bytes) -> str | None:
    text = source.decode("utf-8", errors="replace")
    text = _COMMENT.sub("", text)
    match = _PRAGMA.search(text)
    return " ".join(match.group(1).split()) if match else None


def pick_solc(source: bytes, supported: Sequence[str]) -> str:
    """Returns the highest supported version that satisfies the source's pragma.

    A file without a pragma gets the highest supported version. Raises
    UnsupportedSolcError when the pragma matches none of `supported`.
    """
    versions = sorted(semantic_version.Version(v) for v in supported)
    spec_text = _pragma_spec(source)
    if spec_text is None:
        return str(versions[-1])
    try:
        spec = semantic_version.NpmSpec(_OPERATOR_SPACE.sub(r"\1", spec_text))
    except ValueError as err:
        raise UnsupportedSolcError(f"Unsupported Solidity version: {spec_text}") from err
    chosen = spec.select(versions)
    if chosen is None:
        raise UnsupportedSolcError(f"Unsupported Solidity version: {spec_text}")
    return str(chosen)
