# docs/

Team and project documentation lives here: architecture notes, ADRs (architecture
decision records), design docs, and per-package READMEs.

The repo's root [README.md](../README.md) stays at the top level because GitHub
shows it on the repo front page.

## Contents

- [@bbm/api](api.md): Fastify API, contract upload endpoints.
- [@bbm/web](web.md): Next.js frontend (placeholder).
- [@bbm/shared](shared.md): shared Zod schemas (placeholder).
- [workers/](workers.md): non-TypeScript services (placeholder).
- [contracts/](contracts/overview.md): Foundry smart-contract project.
  - [Foundry setup](contracts/foundry-setup.md): installing Foundry and building and testing `contracts/`.
- [adr/](adr/): architecture decision records.
  - [ADR 0001: Azure environment topology](adr/0001-azure-environment-topology.md): ACA ephemeral envs, AKS per env, data/compute split, OIDC, pinned stack interfaces.
- [devops/](devops/README.md): Azure infrastructure, deployment and operations.
  - [Azure bootstrap](devops/azure-bootstrap.md): one-time subscription and GitHub OIDC setup.
