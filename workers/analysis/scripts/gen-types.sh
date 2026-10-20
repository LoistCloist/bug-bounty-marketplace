#!/usr/bin/env bash
# Generate pydantic v2 models from packages/shared/schema/*.json into
# src/analysis/generated/models.py.
#
# Run from anywhere:  uv run scripts/gen-types.sh
# CI drift check:     uv run scripts/gen-types.sh && git diff --exit-code src/analysis/generated
#
# The schema files are standalone (no cross-file $refs), so they are bundled
# into one schema under $defs (keyed by file name) to get a single module with
# one class per schema. Output is deterministic (no timestamp header, pinned
# generator version via uv.lock, explicit formatters).
#
# `pattern` is dropped from `format: date-time` strings: zod emits a regex
# that only enforces the `Z` suffix, and pydantic cannot apply a string
# pattern to a datetime field (it raises at validation time). The type is
# still a timezone-aware datetime (AwareDatetime).
set -euo pipefail

WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_DIR="${SCHEMA_DIR:-$WORKER_DIR/../../packages/shared/schema}"
OUT_DIR="$WORKER_DIR/src/analysis/generated"

if [[ ! -d "$SCHEMA_DIR" ]]; then
  echo "schema dir not found: $SCHEMA_DIR" >&2
  exit 1
fi

if ! command -v datamodel-codegen >/dev/null 2>&1 || ! command -v python >/dev/null 2>&1; then
  echo "datamodel-codegen/python not on PATH; run via: uv run scripts/gen-types.sh" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

python - "$SCHEMA_DIR" "$TMP_DIR/bundle.json" <<'PY'
import json
import pathlib
import sys

schema_dir, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
defs = {}


def strip_datetime_patterns(node):
    if isinstance(node, dict):
        if node.get("format") == "date-time":
            node.pop("pattern", None)
        for value in node.values():
            strip_datetime_patterns(value)
    elif isinstance(node, list):
        for value in node:
            strip_datetime_patterns(value)


for path in sorted(schema_dir.glob("*.json")):
    schema = json.loads(path.read_text())
    schema.pop("$schema", None)
    strip_datetime_patterns(schema)
    defs[path.stem] = schema
bundle = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$defs": defs}
out.write_text(json.dumps(bundle, indent=2))
PY

mkdir -p "$OUT_DIR"
datamodel-codegen \
  --input "$TMP_DIR/bundle.json" \
  --input-file-type jsonschema \
  --output "$OUT_DIR/models.py" \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.12 \
  --use-standard-collections \
  --use-union-operator \
  --use-schema-description \
  --field-constraints \
  --disable-timestamp \
  --formatters ruff-check ruff-format \
  --custom-file-header "# Generated from packages/shared/schema/*.json by scripts/gen-types.sh. DO NOT EDIT."

[[ -f "$OUT_DIR/__init__.py" ]] || echo '"""Models generated from packages/shared/schema (do not edit)."""' > "$OUT_DIR/__init__.py"
echo "wrote $OUT_DIR/models.py"
