output "acr_name" {
  description = "Container registry name."
  value       = module.acr.name
}

output "acr_login_server" {
  description = "Container registry login server."
  value       = module.acr.login_server
}

output "acr_id" {
  description = "Container registry resource ID."
  value       = module.acr.id
}

output "law_id" {
  description = "Shared Log Analytics workspace ARM ID."
  value       = module.law.id
}

output "law_workspace_id" {
  description = "Shared Log Analytics workspace (customer) GUID."
  value       = module.law.workspace_id
}

output "aca_pull_identity_id" {
  description = "Resource ID of id-bbm-aca-pull."
  value       = azurerm_user_assigned_identity.aca_pull.id
}

output "aca_pull_identity_client_id" {
  description = "Client ID of id-bbm-aca-pull."
  value       = azurerm_user_assigned_identity.aca_pull.client_id
}

output "shared_key_vault_name" {
  description = "Shared Key Vault name."
  value       = azurerm_key_vault.shared.name
}

output "shared_key_vault_id" {
  description = "Shared Key Vault resource ID."
  value       = azurerm_key_vault.shared.id
}

output "shared_resource_group_name" {
  description = "Shared resource group name."
  value       = data.azurerm_resource_group.shared.name
}

output "location" {
  description = "Azure region."
  value       = var.location
}

output "suffix" {
  description = "Name suffix shared by all stacks."
  value       = var.suffix
}
