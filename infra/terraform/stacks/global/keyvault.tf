# Shared vault for cross-environment secrets (Sepolia deployment). Secret
# VALUES are set out-of-band (az keyvault secret set); Terraform only creates
# placeholders and never overwrites them.

locals {
  shared_secrets = ["sepolia-rpc-url", "sepolia-deployer-key", "etherscan-api-key"]
}

resource "azurerm_key_vault" "shared" {
  name                       = module.naming.global.shared_key_vault
  resource_group_name        = data.azurerm_resource_group.shared.name
  location                   = var.location
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 7
  # Off so the name can be purged/reused in a class project; turn on for real prod.
  purge_protection_enabled = false
  tags                     = local.tags
}

resource "azurerm_role_assignment" "kv_secrets_officer" {
  for_each = toset(var.secret_officer_object_ids)

  scope                = azurerm_key_vault.shared.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = each.key
}

resource "azurerm_key_vault_secret" "placeholder" {
  for_each = toset(local.shared_secrets)

  name         = each.key
  value        = "placeholder-set-me"
  content_type = "text/plain"
  key_vault_id = azurerm_key_vault.shared.id

  lifecycle {
    ignore_changes = [value]
  }

  # RBAC data-plane grants must exist before secrets can be written. (CI's
  # gh-bbm-global also has Secrets Officer on the shared RG from bootstrap.)
  depends_on = [azurerm_role_assignment.kv_secrets_officer]
}
