output "environment_name" {
  description = "Container Apps managed environment name."
  value       = azurerm_container_app_environment.this.name
}

output "environment_id" {
  description = "Container Apps managed environment ARM ID."
  value       = azurerm_container_app_environment.this.id
}

output "api_app_name" {
  description = "Name of the api container app."
  value       = azurerm_container_app.api.name
}

output "web_app_name" {
  description = "Name of the web container app."
  value       = azurerm_container_app.web.name
}

output "api_fqdn" {
  description = "Ingress FQDN of the api app."
  value       = azurerm_container_app.api.ingress[0].fqdn
}

output "web_fqdn" {
  description = "Ingress FQDN of the web app."
  value       = azurerm_container_app.web.ingress[0].fqdn
}

output "api_url" {
  description = "Public HTTPS URL of the api app."
  value       = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}

output "web_url" {
  description = "Public HTTPS URL of the web app."
  value       = "https://${azurerm_container_app.web.ingress[0].fqdn}"
}

output "api_internal_url" {
  description = "URL the web app uses to reach the api (API_INTERNAL_URL)."
  value       = local.api_internal_url
}

output "analysis_fqdn" {
  description = "Internal ingress FQDN of the analysis app, or null when disabled."
  value       = var.analysis_enabled ? azurerm_container_app.analysis[0].ingress[0].fqdn : null
}
