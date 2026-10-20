# docs/devops/

How the marketplace is built, deployed and run on Azure. The topology and the interfaces that
Terraform, Helm and the workflows share are decided in
[ADR 0001](../adr/0001-azure-environment-topology.md).

## Contents

- [Azure bootstrap](azure-bootstrap.md): one-time subscription setup. It covers provider
  registration, quota and SKU checks, the bootstrap and global stacks, GitHub OIDC variables and
  environment protection, and the ACR Postgres mirror.

Planned:

- `architecture.md`: diagrams of the global, data, compute and ephemeral layers, the OIDC and
  workload-identity flow, and the request path.
- `env-lifecycle.md`: the power state machine for staging and prod (`pause`, `resume`, `down`,
  `up`), with timings and approvals.
- `cost.md`: estimated monthly cost per environment and power state.
