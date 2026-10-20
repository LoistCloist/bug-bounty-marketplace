output "suffix" {
  description = "Random 4-char suffix for globally unique names. Pass to other stacks (envs/*/*.tfvars: suffix)."
  value       = random_string.suffix.result
}

output "tenant_id" {
  description = "Entra tenant ID."
  value       = data.azurerm_client_config.current.tenant_id
}

output "subscription_id" {
  description = "Subscription GUID."
  value       = var.subscription_id
}

output "location" {
  description = "Azure region."
  value       = var.location
}

output "tfstate_resource_group" {
  description = "State resource group (backend resource_group_name)."
  value       = azurerm_resource_group.tfstate.name
}

output "tfstate_storage_account" {
  description = "State storage account (backend storage_account_name / TFSTATE_ACCOUNT)."
  value       = azurerm_storage_account.tfstate.name
}

output "tfstate_container" {
  description = "State container (backend container_name)."
  value       = azurerm_storage_container.tfstate.name
}

output "resource_groups" {
  description = "Long-lived resource group names keyed by purpose."
  value = merge(
    { shared = azurerm_resource_group.shared.name, tfstate = azurerm_resource_group.tfstate.name },
    { for k, v in azurerm_resource_group.ephemeral : k => v.name },
    { for k, v in azurerm_resource_group.env_data : "${k}-data" => v.name },
    { for k, v in azurerm_resource_group.env_compute : "${k}-compute" => v.name },
  )
}

output "github_client_ids" {
  description = "AZURE_CLIENT_ID per OIDC identity."
  value       = module.github_oidc.client_ids
}

output "github_principal_ids" {
  description = "Service principal object ID per OIDC identity (stacks/global needs gh-bbm-global and gh-bbm-ephemeral)."
  value       = module.github_oidc.principal_ids
}

output "power_operator_role_definition_id" {
  description = "Resource ID of the custom 'BBM Power Operator' role."
  value       = azurerm_role_definition.power_operator.role_definition_resource_id
}

output "global_tfvars_hint" {
  description = "Values to paste into envs/global/global.tfvars."
  value       = <<-EOT
    subscription_id           = "${var.subscription_id}"
    suffix                    = "${random_string.suffix.result}"
    ephemeral_ci_principal_id = "${module.github_oidc.principal_ids["gh-bbm-ephemeral"]}"
    secret_officer_sp_object_ids = ["${module.github_oidc.principal_ids["gh-bbm-global"]}"]
    # Add admin users to secret_officer_user_object_ids and apply locally as an Owner.
  EOT
}

output "gh_setup_commands" {
  description = "Shell commands that create the GitHub repo variables and Environments for this subscription. Review, then run with an authenticated gh CLI (repo admin)."
  value       = join("\n", concat(local.gh_header_lines, local.gh_repo_lines, local.gh_env_lines, [""]))
}
