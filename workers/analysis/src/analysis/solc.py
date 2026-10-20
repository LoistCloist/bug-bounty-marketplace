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


def pick_solc_for_all(sources: Sequence[bytes], supported: Sequence[str]) -> str:
    """The highest supported version that satisfies every source's pragma
    (e.g. a contract and the PoC that imports it). Sources without a pragma
    accept any version."""
    versions = sorted(semantic_version.Version(v) for v in supported)
    texts = [t for t in (_pragma_spec(s) for s in sources) if t is not None]
    candidates = versions
    for text in texts:
        try:
            spec = semantic_version.NpmSpec(_OPERATOR_SPACE.sub(r"\1", text))
        except ValueError as err:
            raise UnsupportedSolcError(f"Unsupported Solidity version: {text}") from err
        candidates = [v for v in candidates if v in spec]
    if not candidates:
        if len(texts) == 1:
            raise UnsupportedSolcError(f"Unsupported Solidity version: {texts[0]}")
        raise UnsupportedSolcError(
            f"No supported Solidity version satisfies all of: {', '.join(texts)}"
        )
    return str(candidates[-1])


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
