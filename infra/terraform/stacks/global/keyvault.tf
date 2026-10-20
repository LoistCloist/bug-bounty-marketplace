# Shared vault for cross-environment secrets (Sepolia deployment:
# sepolia-rpc-url, sepolia-deployer-key, etherscan-api-key). Terraform creates
# only the vault and its RBAC; the secrets are created and set out of band with
# `az keyvault secret set` (docs/devops/azure-bootstrap.md), so externally
# supplied values never enter Terraform state. (An azurerm_key_vault_secret
# with ignore_changes = [value] would still refresh the live value into state.)

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
