"""Reads objects from the source storage directory shared with the API."""

from __future__ import annotations

from pathlib import Path


def read_source(storage_dir: Path, key: str) -> bytes:
    """Reads `key` under `storage_dir`. Refuses keys that escape the root,
    mirroring the API's LocalSourceStorage. Raises FileNotFoundError if absent."""
    root = storage_dir.resolve()
    target = (root / key).resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"Storage key escapes the storage root: {key}")
    return target.read_bytes()
