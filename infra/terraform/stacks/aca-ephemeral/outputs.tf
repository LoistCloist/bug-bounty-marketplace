output "web_url" {
  description = "Public HTTPS URL of the web app."
  value       = module.apps.web_url
}

output "api_url" {
  description = "Public HTTPS URL of the api app."
  value       = module.apps.api_url
}

output "resource_group" {
  description = "Resource group holding the environment (rg-bbm-<kind>-eus2)."
  value       = data.azurerm_resource_group.this.name
}

output "environment_name" {
  description = "Container Apps environment name (cae-bbm-<env_name>)."
  value       = module.apps.environment_name
}
