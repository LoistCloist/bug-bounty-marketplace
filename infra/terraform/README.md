# infra/terraform

Terraform for the BBM Azure deployment (region `eastus2`, project code `bbm`).
First-time subscription setup, including Entra and GitHub prerequisites, is
in [docs/devops/azure-bootstrap.md](../../docs/devops/azure-bootstrap.md).

## Layout

```
infra/terraform/
  .tflint.hcl            shared TFLint config (terraform recommended + azurerm ruleset)
  modules/
    naming/              every resource name + the standard tag set (pure, no resources)
    github-oidc/         Entra app + SP + GitHub federated credentials + RBAC per CI identity
    budget/              subscription or resource-group cost budget with email alerts
    acr/                 container registry (Basic, admin user disabled)
    observability/       Log Analytics workspace (daily cap, 30-day retention)
  stacks/
    bootstrap/           state storage, long-lived RGs, providers, OIDC identities, sub budget
    global/              ACR, shared LAW, id-bbm-aca-pull, shared Key Vault, RG budgets
  envs/
    global/              bootstrap.tfvars, global.tfvars, backend.hcl
  scripts/
    tf.sh                wrapper: picks stack dir, var-file, backend config and state key
```

Later branches add the `data`, `compute` and `aca-ephemeral` stacks, their
modules, the `envs/{staging,prod,test,preview}` directories, and
`scripts/{env-power.sh,janitor.sh}`. `tf.sh` already supports those stacks.

## Running Terraform: `scripts/tf.sh`

```sh
cd infra/terraform
./scripts/tf.sh <stack> <env> <init|plan|apply|destroy|output|validate|...> [extra args]

./scripts/tf.sh global global init
./scripts/tf.sh global global plan -out=tfplan      # -out is relative to stacks/global
./scripts/tf.sh global global apply tfplan
./scripts/tf.sh global global validate              # init -backend=false + validate (no creds)
TF_STATE_KEY=test/run-123-1.tfstate ./scripts/tf.sh aca-ephemeral test plan
```

| stack           | envs             | var-file                       | backend file                                 | state key                |
|-----------------|------------------|--------------------------------|----------------------------------------------|--------------------------|
| `bootstrap`     | `global`         | `envs/global/bootstrap.tfvars` | `envs/global/backend.hcl` (after migration)  | `bootstrap.tfstate`      |
| `global`        | `global`         | `envs/global/global.tfvars`    | `envs/global/backend.hcl`                    | `global.tfstate`         |
| `data`          | `staging`,`prod` | `envs/<env>/data.tfvars`       | `envs/<env>/backend-data.hcl`                | `<env>/data.tfstate`     |
| `compute`       | `staging`,`prod` | `envs/<env>/compute.tfvars`    | `envs/<env>/backend-compute.hcl`             | `<env>/compute.tfstate`  |
| `aca-ephemeral` | `test`,`preview` | `envs/<env>/aca.tfvars`        | `envs/<env>/backend.hcl`                     | `$TF_STATE_KEY` (required) |

- `$TFSTATE_RG` and `$TFSTATE_ACCOUNT` (the GitHub repo variables) override
  the resource group and storage account in the backend file, so CI never
  depends on the placeholder values committed in `backend.hcl`.
- `TF_VAR_*` environment variables pass straight through. CI uses them for
  values like `image_tag`.
- `TF_STATE_KEY` is only read for `aca-ephemeral` and must start with
  `<env>/` (`test/run-<run_id>-<attempt>.tfstate`, `preview/pr-<n>.tfstate`).

## State model

- All remote state lives in storage account `stbbmtfstate<sfx>`, container
  `tfstate`, in RG `rg-bbm-tfstate-eus2`. The account allows Entra auth only
  (`shared_access_key_enabled = false`). Every backend sets
  `use_azuread_auth = true` and `use_oidc = true`. Blob versioning and 14-day
  soft delete let you recover a damaged state file. A `CanNotDelete` lock
  protects the account.
- One state file per stack and env (keys above). Stacks read each other's
  outputs through `terraform_remote_state`: compute reads data, and
  data/compute/aca read global. The exception is `global`, which takes the
  bootstrap outputs it needs (`suffix`, principal IDs) as tfvars.
- **Bootstrap starts on a local backend** because it creates the state
  account. After the first apply:
  1. Uncomment `backend "azurerm" {}` in `stacks/bootstrap/versions.tf`.
  2. Set `storage_account_name` in `envs/global/backend.hcl` to the
     `tfstate_storage_account` output.
  3. Run `./scripts/tf.sh bootstrap global init -migrate-state` and answer `yes`.
  4. Delete `stacks/bootstrap/terraform.tfstate*`.

  `tf.sh` detects whether the backend block is active and only passes
  `-backend-config` when it is.
- CI identities have **Storage Blob Data Contributor** on the `tfstate`
  container. The PR/main plan identity (`gh-bbm-plan`) has **Storage Blob
  Data Reader** only, so plan jobs must pass `-lock=false`.

## Bootstrap order (summary)

1. `az login` as a subscription Owner who can create Entra app registrations.
2. Edit `envs/global/bootstrap.tfvars` (subscription, `admin_object_ids`,
   alert emails, `preregistered_resource_providers`).
3. Run `./scripts/tf.sh bootstrap global init`, then `plan -out=tfplan`, then
   `apply tfplan`.
4. Migrate the bootstrap state as described above.
5. Run `./scripts/tf.sh bootstrap global output -raw gh_setup_commands > /tmp/gh-setup.sh`,
   review the file, then run `bash /tmp/gh-setup.sh`.
6. Copy the `global_tfvars_hint` output into `envs/global/global.tfvars`, then
   apply `global`, either locally or through the `infra-global` workflow.

If an apply fails because a resource provider is already registered, list its
namespace in `preregistered_resource_providers`; the stack then imports it
instead of registering it. You can also import it by hand:
`terraform import 'azurerm_resource_provider_registration.this["Microsoft.Network"]' /subscriptions/<sub>/providers/Microsoft.Network`.

## Static checks (no Azure credentials needed)

```sh
cd infra/terraform
terraform fmt -check -recursive .
./scripts/tf.sh bootstrap global validate && ./scripts/tf.sh global global validate
(cd modules/naming && terraform init -backend=false && terraform test)
(cd stacks/bootstrap && terraform test)   # mock providers
(cd stacks/global && terraform test)      # mock providers
tflint --init && tflint --recursive --config "$(pwd)/.tflint.hcl"
shellcheck scripts/*.sh
```

Pass `--config "$(pwd)/.tflint.hcl"` to TFLint. In `--recursive` mode,
TFLint otherwise looks for a config file inside each module directory and
falls back to defaults, which skip the azurerm ruleset and the extra rules.

After changing provider constraints, refresh the stack lock files for every
platform the team uses:

```sh
terraform -chdir=stacks/<stack> providers lock \
  -platform=linux_amd64 -platform=linux_arm64 -platform=darwin_arm64
```

Lock files are committed for stacks only. Modules inherit the lock file of
the stack that calls them.
