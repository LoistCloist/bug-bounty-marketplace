# Env Key Vault in RBAC mode. The AKS KV CSI driver syncs these secrets into
# the bbm-secrets K8s Secret (SecretProviderClass bbm-kv).
#
# Writing secrets needs a data-plane role. The env CI identity (gh-bbm-<env>)
# gets Key Vault Secrets Officer on the whole data RG from stacks/bootstrap,
# which is inherited by this vault immediately. Humans running Terraform
# locally need to be listed in var.secret_officer_object_ids.

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
  for_each = toset(var.secret_officer_object_ids)

  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = each.key
}

# Role assignments take up to a minute to propagate to the KV data plane.
# Only needed when this module adds new grants; the CI identity's RG-scoped
# grant from bootstrap is long-established by the time this stack runs.
resource "time_sleep" "rbac_propagation" {
  count = length(var.secret_officer_object_ids) > 0 ? 1 : 0

  create_duration = var.rbac_propagation_wait
  triggers = {
    officers = join(",", sort(var.secret_officer_object_ids))
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
