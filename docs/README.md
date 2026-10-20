# docs/

Team and project documentation lives here: architecture notes, ADRs (architecture
decision records), DevOps runbooks and per-package docs.

The repo's root [README.md](../README.md) stays at the top level because GitHub
shows it on the repo front page. Contributor conventions are in
[CLAUDE.md](../CLAUDE.md).

## Contents

- Packages and services
  - [@bbm/web](web.md): Next.js frontend, `/api` proxy, MSW mocks.
  - [@bbm/api](api.md): Fastify API, contract upload endpoints, Postgres and migrations.
  - [@bbm/shared](shared.md): shared Zod schemas and the generated JSON Schema files.
  - [workers/](workers.md): non-TypeScript services (`workers/analysis`).
  - [contracts/](contracts/overview.md): Foundry smart-contract project.
    - [Foundry setup](contracts/foundry-setup.md): installing Foundry and building and testing `contracts/`.
- [adr/](adr/): architecture decision records.
  - [ADR 0001: Azure environment topology](adr/0001-azure-environment-topology.md): ACA ephemeral envs, AKS per env, data/compute split, OIDC, pinned stack interfaces.
- [devops/](devops/README.md): Azure infrastructure, deployment and operations.
  - [Architecture](devops/architecture.md): diagrams of the layers, identity flow and request path.
  - [Environment lifecycle](devops/env-lifecycle.md): powering staging and prod on and off.
  - [Cost](devops/cost.md): estimated monthly cost per environment and power state.
  - [Azure bootstrap](devops/azure-bootstrap.md): one-time subscription and GitHub OIDC setup.

Elsewhere in the repo:

- [tests/README.md](../tests/README.md): test tiers and running the system tests.
- [infra/terraform/README.md](../infra/terraform/README.md): Terraform layout, `tf.sh`, state model.
- [deploy/helm/README.md](../deploy/helm/README.md): Helm chart and values layering.
- [workers/analysis/README.md](../workers/analysis/README.md): analysis worker development.
- [uml/](../uml/): class, sequence and component/deployment diagrams (Mermaid + PNG).
