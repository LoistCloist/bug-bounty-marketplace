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
# pattern to a datetime field (it raises at validation time). Instead the
# models extend analysis.schema_base.BaseModel, which rejects naive datetimes,
# normalises aware ones to UTC and serialises them as `...sssZ` (JS
# toISOString), matching the zod contract on output.
#
# Fidelity fixes applied to the bundle / output (all order-independent):
# - inline enums identical to a file-level enum schema (e.g. Finding.status vs
#   FindingStatus.json) become $refs, so they are typed `FindingStatus`;
# - nullable scalars (anyOf [T, null]) become `type: [T, "null"]`, so they are
#   `str | None` instead of RootModel wrappers;
# - the bundle-root `Model(RootModel[Any])` is removed and scalar RootModel
#   wrappers become Annotated aliases.
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


def inline_nullable_scalars(node):
    """Turn anyOf [<scalar schema>, {type: null}] into one schema with type [T, "null"].

    Otherwise datamodel-codegen emits a RootModel wrapper per nullable field
    (e.g. ClaimedByAuditorId) instead of a plain `str | None`.
    """
    if isinstance(node, dict):
        node = {k: inline_nullable_scalars(v) for k, v in node.items()}
        branches = node.get("anyOf")
        if isinstance(branches, list) and len(branches) == 2 and {"type": "null"} in branches:
            (other,) = [b for b in branches if b != {"type": "null"}]
            if isinstance(other.get("type"), str) and other["type"] in SCALARS:
                merged = {k: v for k, v in node.items() if k != "anyOf"}
                merged.update(other)
                merged["type"] = [other["type"], "null"]
                return merged
        return node
    if isinstance(node, list):
        return [inline_nullable_scalars(v) for v in node]
    return node


SCALARS = {"string", "number", "integer", "boolean"}


def reuse_named_enums(node, named, top=True):
    """Replace inline enums identical to a top-level enum schema with a $ref."""
    if isinstance(node, dict):
        if not top and node.get("type") == "string" and "enum" in node:
            key = tuple(node["enum"])
            if key in named and set(node) <= {"type", "enum", "description"}:
                return {"$ref": f"#/$defs/{named[key]}"}
        return {k: reuse_named_enums(v, named, top=False) for k, v in node.items()}
    if isinstance(node, list):
        return [reuse_named_enums(v, named, top=False) for v in node]
    return node


for path in sorted(schema_dir.glob("*.json")):
    schema = json.loads(path.read_text())
    schema.pop("$schema", None)
    strip_datetime_patterns(schema)
    defs[path.stem] = inline_nullable_scalars(schema)

# File-level enum schemas (e.g. FindingStatus.json) are the canonical names;
# order-independent because the mapping is built before any rewriting.
named = {}
for name, schema in defs.items():
    if schema.get("type") == "string" and "enum" in schema:
        key = tuple(schema["enum"])
        if key in named:
            sys.exit(f"duplicate top-level enum value set: {named[key]} / {name}")
        named[key] = name
defs = {name: reuse_named_enums(schema, named) for name, schema in defs.items()}
bundle = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$defs": defs}
out.write_text(json.dumps(bundle, indent=2))
PY

mkdir -p "$OUT_DIR"
datamodel-codegen \
  --input "$TMP_DIR/bundle.json" \
  --input-file-type jsonschema \
  --output "$OUT_DIR/models.py" \
  --output-model-type pydantic_v2.BaseModel \
  --base-class analysis.schema_base.BaseModel \
  --output-datetime-class AwareDatetime \
  --collapse-root-models \
  --use-annotated \
  --target-python-version 3.12 \
  --use-standard-collections \
  --use-union-operator \
  --use-schema-description \
  --field-constraints \
  --disable-timestamp \
  --formatters ruff-check ruff-format \
  --custom-file-header "# Generated from packages/shared/schema/*.json by scripts/gen-types.sh. DO NOT EDIT."

# Post-process: drop the junk `Model(RootModel[Any])` emitted for the bundle
# root, and turn scalar RootModel wrappers (e.g. array items with minLength,
# such as ClaimedContractId) into plain Annotated aliases so values are `str`.
python - "$OUT_DIR/models.py" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
src = path.read_text()
src, n = re.subn(r"\nclass Model\(RootModel\[Any\]\):\n    root: Any\n\n", "\n", src)
if n != 1:
    sys.exit("expected exactly one bundle-root `Model` class to remove")
src = re.sub(
    r"^class (\w+)\(RootModel\[(str|int|float|bool)\]\):\n    root: (Annotated\[.*\])\n",
    r"\1 = \3\n",
    src,
    flags=re.M,
)
if re.search(r"\(RootModel\[", src):
    sys.exit("unexpected RootModel left in generated models; update gen-types.sh")
path.write_text(src)
PY
ruff check --fix --quiet "$OUT_DIR/models.py"
ruff format --quiet "$OUT_DIR/models.py"

[[ -f "$OUT_DIR/__init__.py" ]] || echo '"""Models generated from packages/shared/schema (do not edit)."""' > "$OUT_DIR/__init__.py"
echo "wrote $OUT_DIR/models.py"
