# Azure bootstrap

One-time setup of the brand-new Azure subscription, done by a person with **Owner** on the
subscription who can also create Entra app registrations, and **admin** on the GitHub repo. After
this, CI takes over: every Azure workflow skips until the repo variables written here exist.

Design background and the names used below are in
[ADR 0001](../adr/0001-azure-environment-topology.md). The Terraform layout and the `tf.sh` wrapper
are described in [infra/terraform/README.md](../../infra/terraform/README.md).

What bootstrap creates (`infra/terraform/stacks/bootstrap`):

- The state storage account `stbbmtfstate<sfx>` in `rg-bbm-tfstate-eus2`, container `tfstate`.
  - Entra auth only, with blob versioning and 14-day soft delete.
  - Protected by a `CanNotDelete` lock named `lock-bbm-tfstate`.
- **Every** long-lived resource group:
  - `rg-bbm-shared-eus2`, `rg-bbm-test-eus2` and `rg-bbm-preview-eus2`.
  - `rg-bbm-<env>-data-eus2` and `rg-bbm-<env>-compute-eus2` for staging and prod.
- Resource provider registrations.
- The GitHub OIDC app registrations (`gh-bbm-plan`, `gh-bbm-ephemeral`, `gh-bbm-global`,
  `gh-bbm-staging`, `gh-bbm-prod`, `gh-bbm-prod-power`), their federated credentials and role
  assignments, plus the custom roles `BBM Power Operator`, `BBM tfstate writer` and
  `BBM tfstate reader`. Each CI identity's state access is limited to its own state keys by ABAC
  conditions (see the
  [ADR](../adr/0001-azure-environment-topology.md#4-github-to-azure-over-oidc)).
- The $50/month subscription budget.

Then `stacks/global` adds the ACR, the shared Log Analytics workspace, `id-bbm-aca-pull`, the shared
Key Vault (no secrets: you set those with `az` in step 12) and per-RG budgets.

All commands below run from `infra/terraform` unless a step says otherwise.

## 1. Prerequisites

| Tool       | Version                          | Check               |
| ---------- | -------------------------------- | ------------------- |
| Azure CLI  | 2.60+                            | `az version`        |
| Terraform  | 1.9.x                            | `terraform version` |
| GitHub CLI | 2.40+, logged in with repo admin | `gh auth status`    |

You also need `jq` and `bash`.

## 2. Log in and collect IDs

```sh
az login
az account list -o table
az account set --subscription "<subscription-id>"
az account show --query "{name:name, id:id, tenant:tenantId, user:user.name}" -o table
```

Locally, the providers and backend use your `az login` session. `use_oidc = true` only takes effect
in CI.

Collect these values for `bootstrap.tfvars`:

```sh
az ad signed-in-user show --query id -o tsv                 # your object ID
az ad group show -g bbm-admins --query id -o tsv            # admins group, if you created one
gh api users/<github-login> --jq .id                        # numeric GitHub user ID per reviewer
```

## 3. Check resource providers

Bootstrap registers these providers itself (`azurerm_resource_provider_registration`):

- Containers: `Microsoft.ContainerService`, `Microsoft.App`, `Microsoft.ContainerRegistry`.
- Data and secrets: `Microsoft.DBforPostgreSQL`, `Microsoft.KeyVault`, `Microsoft.Storage`.
- Networking, compute and identity: `Microsoft.Network`, `Microsoft.Compute`,
  `Microsoft.ManagedIdentity`.
- Monitoring: `Microsoft.OperationalInsights`, `Microsoft.Insights`,
  `Microsoft.OperationsManagement`, `Microsoft.AlertsManagement`.
- Cost: `Microsoft.Consumption`, `Microsoft.CostManagement`.

Some of them are already registered on a new subscription, and registering them again fails the
apply. List the ones that are already registered:

```sh
az provider list --query "[?registrationState=='Registered'].namespace" -o tsv \
  | grep -xE 'Microsoft\.(ContainerService|App|DBforPostgreSQL|OperationalInsights|KeyVault|ContainerRegistry|Storage|Network|ManagedIdentity|Compute|Insights|OperationsManagement|AlertsManagement|Consumption|CostManagement)'
```

Put every namespace it prints into `preregistered_resource_providers` in
`envs/global/bootstrap.tfvars`. The stack then imports them instead of registering them.

Do **not** pre-register the rest by hand with `az provider register`. If you already did, list
those namespaces too.

## 4. Check quota, SKUs and versions

### vCPU quota

```sh
az vm list-usage -l eastus2 -o table
```

Look at these rows:

| Row                         | Needed for                              | Rough need                                      |
| --------------------------- | --------------------------------------- | ----------------------------------------------- |
| Total Regional vCPUs        | everything                              | 8+ for one env running, 16+ for both            |
| Standard BSv2 Family vCPUs  | Intel B-series fallback                 | a few                                           |
| Standard BASv2 Family vCPUs | `Standard_B2als_v2` (default node size) | 2 vCPUs per node; system 1–2 + apps 0–3 per env |
| Standard DSv5 Family vCPUs  | Kata sandbox pool (disabled by default) | 0 until the sandbox is enabled                  |

New subscriptions often show a low regional limit (sometimes 4–10) and 0 for some families.

To ask for more:

1. Go to **Portal → Quotas → Compute**.
2. Filter by region `East US 2` and select the family.
3. Choose **New quota request**.

Small increases on B-series are usually approved automatically within minutes. Larger ones may open
a support request.

### PostgreSQL Flexible Server SKU

```sh
az postgres flexible-server list-skus -l eastus2 -o json \
  | jq -r '.[].supportedServerEditions[] | select(.name=="Burstable") | .supportedServerSkus[].name' \
  | grep -i b1ms
```

If `Standard_B1ms` isn't listed, or the output is empty, PG Flexible is restricted for this
subscription in `eastus2`.

### AKS versions

```sh
az aks get-versions -l eastus2 -o table
```

Note a supported, non-preview minor version for the compute stack (added in a later branch).

### Fallback region

If AKS, PG Flexible or the B-series families are restricted in `eastus2` and a quota request doesn't
fix it, use `centralus`:

1. Re-run the checks above with `-l centralus`.
2. Set `location = "centralus"` and `location_abbr = "cus"` in `bootstrap.tfvars` and
   `global.tfvars`, and in the env tfvars once they exist.

Do this **before** the first bootstrap apply, because moving regions later means recreating
everything.

## 5. Fill in `envs/global/bootstrap.tfvars`

| Variable                           | Value                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `subscription_id`                  | subscription GUID (lowercase)                                               |
| `location` / `location_abbr`       | `eastus2` / `eus2` (or the fallback)                                        |
| `github_repo`                      | `LoistCloist/bug-bounty-marketplace`                                        |
| `admin_object_ids`                 | admin object IDs (e.g. the `bbm-admins` group); get state + AKS admin       |
| `power_operator_object_ids`        | people allowed to pause/resume via `BBM Power Operator` (optional)          |
| `alert_emails`                     | budget alert recipients                                                     |
| `subscription_budget_amount`       | `50`                                                                        |
| `budget_start_date`                | first of the current month, RFC3339                                         |
| `github_reviewer_ids`              | numeric GitHub user IDs for required reviewers (empty = add them in the UI) |
| `preregistered_resource_providers` | the list from step 3                                                        |

The account that runs the apply automatically gets Storage Blob Data Contributor on the state
container, alongside `admin_object_ids`. These human grants are unconditioned; they are the only
principals that can read or write `bootstrap.tfstate` and `prod/` from outside the `prod` environment,
and the only ones that can create or delete the container. CI identities get the custom
`BBM tfstate writer` / `BBM tfstate reader` roles instead (see `infra/terraform/README.md`).

## 6. Apply bootstrap (local state)

Bootstrap creates the storage account that every other stack keeps its state in, so its first apply
uses local state. The `backend "azurerm" {}` block in `stacks/bootstrap/versions.tf` ships commented
out, and `tf.sh` only passes `-backend-config` when that block is active.

```sh
./scripts/tf.sh bootstrap global init
./scripts/tf.sh bootstrap global plan -out=tfplan   # tfplan is written inside stacks/bootstrap
./scripts/tf.sh bootstrap global apply tfplan
./scripts/tf.sh bootstrap global output
```

If the apply fails with "already registered" for a provider, add that namespace to
`preregistered_resource_providers` and re-apply.

## 7. Migrate bootstrap state into the storage account

1. Uncomment `backend "azurerm" {}` in `stacks/bootstrap/versions.tf`.
2. Set `storage_account_name` in `envs/global/backend.hcl` to the `tfstate_storage_account` output,
   and commit both changes.
3. Migrate, and answer `yes` to copy the existing state:

   ```sh
   ./scripts/tf.sh bootstrap global init -migrate-state
   ```

   `tf.sh` adds `-backend-config=envs/global/backend.hcl -backend-config=key=bootstrap.tfstate`, and
   leaves out `-input=false` for `-migrate-state` / `-reconfigure` so the prompt works. In
   non-interactive shells add `-force-copy` instead of answering.

4. Confirm the move, then delete the local copy:

   ```sh
   ./scripts/tf.sh bootstrap global plan          # expect: No changes
   rm -f stacks/bootstrap/terraform.tfstate*
   ```

The backend uses Entra ID auth (`use_azuread_auth = true`). Role assignments can take a few minutes
to propagate, so if `init` gets a 403, wait and retry.

For later local runs, either keep `backend.hcl` up to date or export the same values that CI uses.
`tf.sh` passes them as backend overrides:

```sh
export TFSTATE_RG=rg-bbm-tfstate-eus2
export TFSTATE_ACCOUNT=$(./scripts/tf.sh bootstrap global output -raw tfstate_storage_account)
```

## 8. Write the GitHub variables and Environments

The `gh_setup_commands` output is a script. It does three things:

- Sets the repo variables: `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_PLAN_CLIENT_ID`,
  `TFSTATE_RG`, `TFSTATE_ACCOUNT` and `ACR_NAME`. `ACR_NAME` is already known, because names come
  from `modules/naming`.
- Creates all seven GitHub Environments with their reviewers and branch policies. `prod-power` gets
  its own identity, `gh-bbm-prod-power`, which can only pause and resume prod (`BBM Power Operator`).
- Sets `AZURE_CLIENT_ID` on each environment.

Review the script before running it:

```sh
./scripts/tf.sh bootstrap global output -raw gh_setup_commands > /tmp/gh-setup.sh
less /tmp/gh-setup.sh
bash /tmp/gh-setup.sh
```

These are variables, not secrets. OIDC needs no client secret. The script is safe to re-run: when
`github_reviewer_ids` is empty it doesn't send a `reviewers` field for `infra-global`, `prod` and
`contracts-sepolia`, so reviewers you added by hand are kept.

## 9. Check GitHub Environment protection

The script applies these rules:

| Environment         | Required reviewers                              | Deployment branches         |
| ------------------- | ----------------------------------------------- | --------------------------- |
| `test`, `preview`   | none                                            | any (PR branches need them) |
| `infra-global`      | 1                                               | `main`                      |
| `staging`           | none                                            | `main`                      |
| `prod`              | 1                                               | `main`                      |
| `prod-power`        | none (scheduled auto-pause must run unattended) | `main`                      |
| `contracts-sepolia` | 1                                               | any                         |

If `github_reviewer_ids` was empty, the script prints a note and creates the environments without
reviewers. Add them in one of two ways:

- **UI:** go to **Settings → Environments → `<env>`**, tick **Required reviewers** and add one
  person.
- **CLI:** for example, for `prod`:

  ```sh
  REPO=LoistCloist/bug-bounty-marketplace
  REVIEWER_ID=$(gh api users/<github-login> --jq .id)

  gh api -X PUT "repos/$REPO/environments/prod" --input - <<EOF
  {
    "reviewers": [{ "type": "User", "id": $REVIEWER_ID }],
    "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
  }
  EOF
  ```

  Repeat for `infra-global`. For `contracts-sepolia`, which isn't branch-restricted, send
  `"deployment_branch_policy": null`.

## 10. Apply the global stack

1. Paste the `global_tfvars_hint` output into `envs/global/global.tfvars`. It contains:
   - `subscription_id` and `suffix`.
   - `ephemeral_ci_principal_id`, the `gh-bbm-ephemeral` service principal.
   - `secret_officer_sp_object_ids`, the `gh-bbm-global` service principal. These assignments use
     `principal_type = "ServicePrincipal"`, so CI can apply them.

   ```sh
   ./scripts/tf.sh bootstrap global output -raw global_tfvars_hint
   ```

2. **Add your own user object ID to `secret_officer_user_object_ids`.** Without it you can't set the
   shared secrets in step 12: the vault uses RBAC, and being subscription Owner doesn't grant
   data-plane access. Get your ID with `az ad signed-in-user show --query id -o tsv`. These
   assignments use `principal_type = "User"` (groups aren't supported), and CI (`gh-bbm-global`) may
   only create role assignments for service principals, so **apply every change to this list locally
   as a subscription Owner**. A CI apply that has to add or remove a user entry fails.
   `acr_push_principal_ids` likewise takes build identities (service principals) only.
3. Review `alert_emails`, `rg_budget_amount` and `law_daily_quota_gb`.
4. Apply:

   ```sh
   ./scripts/tf.sh global global init
   ./scripts/tf.sh global global plan -out=tfplan
   ./scripts/tf.sh global global apply tfplan
   ```

This fills `rg-bbm-shared-eus2` with `acrbbm<sfx>`, `log-bbm-shared-eus2`, `id-bbm-aca-pull` and an
empty `kv-bbm-shared-<sfx>`. It also grants `gh-bbm-ephemeral` AcrPush, Managed Identity Operator on
`id-bbm-aca-pull` and Log Analytics Contributor. After this, `terraform.yml` applies `global` on
pushes to `main` through the `infra-global` environment.

## 11. Mirror the Postgres and curl images into ACR

The ephemeral envs pull their Postgres sidecar from ACR, not Docker Hub, to avoid anonymous pull
rate limits. The `helm test` pod on staging/prod likewise pulls `<acr>/mirror/curl:8.10.1`
(`tests.mirrorImage` in the chart), so a missing mirror fails `helm test` with `ImagePullBackOff`:

```sh
ACR=$(./scripts/tf.sh global global output -raw acr_name)
az acr import -n "$ACR" \
  --source docker.io/library/postgres:16-alpine \
  --image mirror/postgres:16-alpine
az acr import -n "$ACR" \
  --source docker.io/curlimages/curl:8.10.1 \
  --image mirror/curl:8.10.1
```

Re-run the Postgres import with `--force` to pick up a newer patch release.

## 12. Set the shared Key Vault secrets

Terraform creates only the vault. It doesn't manage these secrets at all, because even a
placeholder resource with `ignore_changes` refreshes the live value into state. Create them with `az`,
so externally supplied values never enter Terraform state:

```sh
KV=$(./scripts/tf.sh global global output -raw shared_key_vault_name)
az keyvault secret set --vault-name "$KV" --name sepolia-rpc-url      --value "https://..."
az keyvault secret set --vault-name "$KV" --name sepolia-deployer-key --file ./deployer.key
az keyvault secret set --vault-name "$KV" --name etherscan-api-key    --value "..."   # optional
```

Use `--file` for the deployer key so it doesn't land in shell history, then delete the file. A 403
(`ForbiddenByRbac`) means you aren't in `secret_officer_user_object_ids` (step 10), or the assignment
hasn't propagated yet (wait a few minutes and retry).

The env vaults (`kv-bbm-stg-<sfx>`, `kv-bbm-prd-<sfx>`) get `llm-api-key` in step 13.

## 13. Per env: set `llm-api-key` before the first deploy

**Required** for staging and for prod, after that env's `data` stack is applied and **before** the
first deploy to it. Terraform writes only `database-url` and `pg-admin-password` to the env vault;
`llm-api-key` is set out of band so the real value never enters state. The Helm chart's
SecretProviderClass mounts all three, so if `llm-api-key` is missing the pods stay in
`ContainerCreating` (the CSI mount fails), the release times out and `--atomic` rolls it back.

```sh
KV=$(./scripts/tf.sh data staging output -raw key_vault_name)   # repeat with prod
az keyvault secret set --vault-name "$KV" -n llm-api-key --value "<key or placeholder-set-me>"
```

A placeholder such as `placeholder-set-me` is enough to get the pods running; replace it with the
real key later (the CSI driver picks up the new version within its 2-minute rotation interval). A
403 means your user isn't in `secret_officer_user_object_ids` in `envs/<env>/data.tfvars`. Those
grants use `principal_type = "User"`, which CI can't create, so apply that list locally as a
subscription Owner first; CI then sees no diff.

## Verification checklist

- [ ] `az provider list --query "[?registrationState!='Registered'].namespace" -o tsv` doesn't
      include any namespace from step 3.
- [ ] `az vm list-usage -l eastus2` shows enough Total Regional and BASv2 vCPUs.
- [ ] `az group list --query "[?tags.project=='bbm'].name" -o tsv` lists the RGs: tfstate, shared,
      test, preview, and the data and compute RGs for staging and prod.
- [ ] `az lock list -g rg-bbm-tfstate-eus2 -o table` shows `lock-bbm-tfstate`.
- [ ] `./scripts/tf.sh bootstrap global plan` on the remote backend reports **No changes**, and no
      `stacks/bootstrap/terraform.tfstate*` remains.
- [ ] `az ad app list --display-name gh-bbm- --query "[].displayName" -o tsv` lists `gh-bbm-plan`,
      `gh-bbm-ephemeral`, `gh-bbm-global`, `gh-bbm-staging`, `gh-bbm-prod` and `gh-bbm-prod-power`.
- [ ] `gh variable list --repo LoistCloist/bug-bounty-marketplace` shows the six repo variables.
- [ ] `gh api repos/LoistCloist/bug-bounty-marketplace/environments --jq '.environments[].name'`
      lists all seven environments.
- [ ] Reviewer and branch rules match the table in step 9.
- [ ] `az acr repository show -n <acr> --repository mirror/postgres` and
      `az acr repository show -n <acr> --repository mirror/curl` succeed.
- [ ] `az keyvault secret list --vault-name <shared-kv> --query "[].name" -o tsv` lists
      `sepolia-rpc-url` and `sepolia-deployer-key` (and `etherscan-api-key` if set).
- [ ] For each env whose `data` stack is applied,
      `az keyvault secret show --vault-name <env-kv> -n llm-api-key --query name -o tsv` prints
      `llm-api-key`.
- [ ] Dispatch `terraform.yml` with a `plan` of `global`. It should log in through OIDC and report no
      changes. Plan jobs run with `-lock=false`, because `gh-bbm-plan` only has a path-conditioned
      `BBM tfstate reader` on state.

## Teardown and reset

1. **Environments.** Run `down` for staging and prod through `env-power.yml`, then destroy each
   `data` stack (`./scripts/tf.sh data <env> destroy`). Ephemeral envs clean themselves up, and
   `infra-janitor.yml` sweeps leftovers.
2. **Global:** `./scripts/tf.sh global global destroy`.
3. **Bootstrap, last.** Its state lives in the account it is about to delete.
   1. Migrate the state back to local: re-comment the backend block in
      `stacks/bootstrap/versions.tf`, then run `terraform -chdir=stacks/bootstrap init -migrate-state`.
   2. Run `./scripts/tf.sh bootstrap global destroy`. The `CanNotDelete` lock `lock-bbm-tfstate`
      is in bootstrap state, and Terraform deletes it before the storage account.
   3. Deleting the state account or `rg-bbm-tfstate-eus2` any other way (portal, `az group delete`)
      fails with `ScopeLocked` until you remove the lock deliberately:

      ```sh
      az lock delete -n lock-bbm-tfstate -g rg-bbm-tfstate-eus2 \
        --resource-type Microsoft.Storage/storageAccounts --resource <tfstate-account>
      ```

   4. Remove the GitHub variables and environments by hand.

- **Key Vault soft delete.** Destroyed vaults stay soft-deleted for 7 days, and their names stay
  reserved. Terraform does not purge on destroy. To reuse a name sooner:
  `az keyvault purge -n <name> -l eastus2`.
- **App registrations** deleted by Terraform go to the Entra recycle bin for 30 days. That only
  matters if you need the same display names right away.
- **Resetting a damaged state file.** The state account keeps blob versions and 14 days of soft
  delete. Restore an earlier version of the blob from **Portal → Storage account → Containers →
  tfstate → `<key>` → Versions**.

## Troubleshooting

| Symptom                                                                                                     | Cause and fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MissingSubscriptionRegistration` / "The subscription is not registered to use namespace ..."               | A provider isn't registered yet. The provider config sets `resource_provider_registrations = "none"`, so only bootstrap's explicit registrations count. Re-apply bootstrap, or check `az provider show -n <ns> --query registrationState`. Registration can take several minutes after the apply.                                                                                                                                                                                     |
| Bootstrap apply fails because a provider is "already registered"                                            | Add the namespace to `preregistered_resource_providers` and re-apply. Or import it: `terraform import 'azurerm_resource_provider_registration.this["Microsoft.Network"]' /subscriptions/<sub>/providers/Microsoft.Network`.                                                                                                                                                                                                                                                           |
| "The location is restricted for this subscription" / `LocationIsOfferRestricted` (often PG Flexible or AKS) | The new subscription is blocked for that SKU in the region. Request access through a support ticket (**Portal → Help + support → Service and subscription limits**), or switch to `centralus` before the first apply (step 4).                                                                                                                                                                                                                                                        |
| `QuotaExceeded` / "Operation could only be completed if ... vCPUs" when creating node pools                 | Not enough family or regional vCPUs. Request an increase (step 4). Meanwhile, keep the staging `apps` pool at min 0 and the sandbox pool disabled.                                                                                                                                                                                                                                                                                                                                    |
| `VaultAlreadyExists` / "a vault with the same name already exists in deleted state"                         | A soft-deleted vault holds the name. The provider sets `recover_soft_deleted_key_vaults = true`, so a re-apply normally recovers it. Otherwise run `az keyvault list-deleted -o table`, then `az keyvault recover -n <name>` to keep its secrets, or `az keyvault purge -n <name> -l eastus2` to start fresh.                                                                                                                                                                         |
| `AADSTS700213: No matching federated identity record found for presented assertion subject`                 | The workflow's OIDC subject doesn't match a federated credential. Jobs that declare `environment: <env>` present `repo:LoistCloist/bug-bounty-marketplace:environment:<env>`. Plan jobs present `...:pull_request` or `...:ref:refs/heads/main`. Check the job's `environment:` key, that `AZURE_CLIENT_ID` belongs to the app for that environment, and the configured subjects (`az ad app federated-credential list --id <app-id>`). Repo renames or transfers change the subject. |
| `AADSTS700212: No matching federated identity record found for presented assertion audience`                | The `azure/login` audience must be `api://AzureADTokenExchange` (the default).                                                                                                                                                                                                                                                                                                                                                                                                        |
| 403 `AuthorizationPermissionMismatch` on state blobs                                                        | The identity lacks its `BBM tfstate writer`/`reader` role on `tfstate`, the key is outside the prefixes its ABAC condition allows (e.g. `gh-bbm-plan` reading `prod/`, or a non-`test/`/`preview/` `TF_STATE_KEY`), or the role assignment hasn't propagated yet (allow up to about 10 minutes).                                                                                                                                                                                      |
| Plan job fails to acquire the state lock (403 on the lease)                                                 | `gh-bbm-plan` is read-only on state by design. Run plan with `-lock=false`.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ScopeLocked` when deleting the state account or its RG                                                     | The `lock-bbm-tfstate` lock is doing its job. See [Teardown and reset](#teardown-and-reset).                                                                                                                                                                                                                                                                                                                                                                                          |
| `az acr import` fails with an authentication error                                                          | Your user needs Contributor or `AcrImport` rights on the registry. Owner on the subscription is enough. Check that the ACR name is right.                                                                                                                                                                                                                                                                                                                                             |
