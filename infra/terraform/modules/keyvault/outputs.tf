output "id" {
  description = "Key Vault resource ID."
  value       = azurerm_key_vault.this.id
}

output "name" {
  description = "Key Vault name."
  value       = azurerm_key_vault.this.name
}

output "vault_uri" {
  description = "Key Vault data-plane URI."
  value       = azurerm_key_vault.this.vault_uri
}

output "secret_names" {
  description = "Names of the Terraform-managed secrets."
  value       = sort(keys(azurerm_key_vault_secret.managed))
}

output "rbac_authorization_enabled" {
  description = "Whether the vault uses Azure RBAC for data-plane access (always true)."
  value       = azurerm_key_vault.this.rbac_authorization_enabled
}
