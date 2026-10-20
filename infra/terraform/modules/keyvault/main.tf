# Env Key Vault in RBAC mode. The AKS KV CSI driver syncs these secrets into
# the bbm-secrets K8s Secret (SecretProviderClass bbm-kv).
#
# Writing secrets needs a data-plane role. The env CI identity (gh-bbm-<env>)
# gets Key Vault Secrets Officer on the whole data RG from stacks/bootstrap,
# which is inherited by this vault immediately. Extra grants mirror the
# stacks/global split: service principals (var.secret_officer_sp_object_ids,
# principal_type ServicePrincipal) can be applied by CI, whose constrained
# RBAC admin (bootstrap ABAC condition) may only assign roles to service
# principals. Users (var.secret_officer_user_object_ids, principal_type User)
# must be applied locally by a subscription Owner first; CI then sees no diff.

locals {
  secret_officers = merge(
    { for id in var.secret_officer_sp_object_ids : "sp/${id}" => { id = id, type = "ServicePrincipal" } },
    { for id in var.secret_officer_user_object_ids : "user/${id}" => { id = id, type = "User" } },
  )
}

resource "azurerm_key_vault" "this" {
  name                       = var.name
  resource_group_name        = var.resource_group_name
  location                   = var.location
  tenant_id                  = var.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 7
  # Off so the name can be purged/reused in a class project; turn on for real prod.
  purge_protection_enabled = false
  tags                     = var.tags

  # Public endpoint stays open: GitHub-hosted runners (dynamic IPs) write the
  # secrets and AKS reads them over the public endpoint. Access is RBAC-gated.
  network_acls {
    default_action = "Allow"
    bypass         = "AzureServices"
  }
}

resource "azurerm_role_assignment" "secrets_officer" {
  for_each = local.secret_officers

  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = each.value.id
  principal_type       = each.value.type
}

# Role assignments take up to a minute to propagate to the KV data plane.
# Only needed when this module adds new grants; the CI identity's RG-scoped
# grant from bootstrap is long-established by the time this stack runs.
resource "time_sleep" "rbac_propagation" {
  count = length(local.secret_officers) > 0 ? 1 : 0

  create_duration = var.rbac_propagation_wait
  triggers = {
    officers = join(",", sort(keys(local.secret_officers)))
  }

  depends_on = [azurerm_role_assignment.secrets_officer]
}

# Only Terraform-generated secrets live here. Their values are in this stack's
# state (state access is prefix-scoped per environment: <env>/data.tfstate).
# Externally supplied secrets (e.g. llm-api-key) are NOT managed by Terraform,
# because even with ignore_changes = [value] a refresh would copy the real
# value into state. Set those out of band:
#   az keyvault secret set --vault-name <kv> --name llm-api-key --value ...
resource "azurerm_key_vault_secret" "managed" {
  # nonsensitive() on the keys only: secret names are not secret.
  for_each = toset(nonsensitive(keys(var.secrets)))

  name         = each.key
  value        = var.secrets[each.key]
  content_type = "text/plain"
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [time_sleep.rbac_propagation]
}
