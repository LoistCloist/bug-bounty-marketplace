"""Filename handling for untrusted upload names."""

from __future__ import annotations

import re

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def safe_filename(name: str) -> str:
    """The uploaded `.sol` name, made safe to use as a single file name.

    Keeps the name the API shows (spaces, brackets and all), because auditors
    import the target by it (`import "../src/<filename>";`). Drops any directory
    part (both `/` and `\\`), control characters and leading dots or spaces,
    and falls back to `Contract.sol` when no usable `.sol` name is left.
    """
    base = re.split(r"[\\/]", name)[-1]
    cleaned = _CONTROL.sub("", base).lstrip(". ")
    stem = cleaned[: -len(".sol")] if cleaned.lower().endswith(".sol") else ""
    if not stem.strip(" ._"):
        return "Contract.sol"
    return cleaned
