output "id" {
  description = "Storage account resource ID."
  value       = azurerm_storage_account.this.id
}

output "name" {
  description = "Storage account name."
  value       = azurerm_storage_account.this.name
}

output "primary_blob_endpoint" {
  description = "Blob service endpoint (https://<name>.blob.core.windows.net/)."
  value       = azurerm_storage_account.this.primary_blob_endpoint
}

output "primary_queue_endpoint" {
  description = "Queue service endpoint (https://<name>.queue.core.windows.net/)."
  value       = azurerm_storage_account.this.primary_queue_endpoint
}

output "container_name" {
  description = "Blob container name for contract sources."
  value       = azurerm_storage_container.sources.name
}

output "container_id" {
  description = "ARM resource ID of the sources container (usable as an RBAC scope)."
  value       = azurerm_storage_container.sources.id
}

output "queue_name" {
  description = "Analysis job queue name."
  value       = azurerm_storage_queue.jobs.name
}

output "queue_id" {
  description = "ARM resource ID of the analysis job queue (usable as an RBAC scope)."
  value       = azurerm_storage_queue.jobs.id
}

output "shared_access_key_enabled" {
  description = "Whether shared-key (account key/SAS) auth is enabled (always false)."
  value       = azurerm_storage_account.this.shared_access_key_enabled
}
