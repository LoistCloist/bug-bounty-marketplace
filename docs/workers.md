# workers/

Non-TypeScript backend services live here (static analysis runners, PoC
sandboxes, AI explanation workers, etc.). This directory is **not** part of
the pnpm workspace — each service manages its own toolchain.

## Conventions for a new service

- Each service gets its own directory, e.g. `workers/analysis/`.
- Python services use `uv` + `pyproject.toml` for dependency management.
- Rust services use `Cargo.toml`.
- Each service has its own `Dockerfile`.
- Each service has its own path-filtered CI job, added when that service is
  created (triggered only on changes under that service's directory or
  `packages/shared/schema/**`).
- Types are generated from the JSON Schema files published at
  `packages/shared/schema/*.json` (added in `feat/shared-schemas`):
  - Python: `datamodel-code-generator`
  - Rust: `typify`

No service exists yet — this is a placeholder for the directory layout.
