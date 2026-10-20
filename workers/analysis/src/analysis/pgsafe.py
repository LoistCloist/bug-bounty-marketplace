"""Values Postgres can store: TEXT rejects NUL bytes and JSONB rejects \\u0000."""

from __future__ import annotations

from typing import Any


def without_nul(value: Any) -> Any:
    """Replaces NUL characters with the two characters `\\0`, recursively
    through dict keys/values and lists. Other values are returned unchanged.

    Solidity like `a.call("\\x00")` puts real NULs into Slither's descriptions.
    """
    if isinstance(value, str):
        return value.replace("\x00", "\\0")
    if isinstance(value, dict):
        return {without_nul(k): without_nul(v) for k, v in value.items()}
    if isinstance(value, list):
        return [without_nul(v) for v in value]
    return value
