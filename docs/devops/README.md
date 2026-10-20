# docs/devops/

How the marketplace is built, deployed and run on Azure. The topology and the interfaces that
Terraform, Helm and the workflows share are decided in
[ADR 0001](../adr/0001-azure-environment-topology.md).

## Contents

- [Architecture](architecture.md): diagrams of the global, data, compute and ephemeral layers, the
  OIDC and workload-identity flow, and the request path.
- [Environment lifecycle](env-lifecycle.md): the power state machine for staging and prod
  (`pause`, `resume`, `down`, `up`), with timings, approvals, schedules and a demo-day checklist.
- [Cost](cost.md): estimated monthly cost per environment and power state.
- [Azure bootstrap](azure-bootstrap.md): one-time subscription setup. It covers provider
  registration, quota and SKU checks, the bootstrap and global stacks, GitHub OIDC variables and
  environment protection, the ACR image mirror and the Key Vault secrets.

## Related

- [infra/terraform/README.md](../../infra/terraform/README.md): modules, stacks, `scripts/tf.sh`,
  state model, ephemeral ACA environments, static checks.
- [deploy/helm/README.md](../../deploy/helm/README.md): the `bbm` chart, values layering, secrets.
- [tests/README.md](../../tests/README.md): which test tiers run in which workflow and environment.
- Workflows in [`.github/workflows/`](../../.github/workflows/): `ci.yml` (Azure-free, `CI OK`
  gate), `_build-push.yml`, `integration-azure.yml`, `preview.yml`, `terraform.yml`, `deploy.yml`,
  `env-power.yml`, `contracts-deploy.yml`, `infra-janitor.yml`.
