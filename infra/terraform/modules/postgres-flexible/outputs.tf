output "id" {
  description = "Server resource ID."
  value       = azurerm_postgresql_flexible_server.this.id
}

output "name" {
  description = "Server name."
  value       = azurerm_postgresql_flexible_server.this.name
}

output "fqdn" {
  description = "Server FQDN (resolves privately through the linked DNS zone)."
  value       = azurerm_postgresql_flexible_server.this.fqdn
}

output "database_name" {
  description = "Application database name."
  value       = azurerm_postgresql_flexible_server_database.app.name
}

output "administrator_login" {
  description = "Admin user name."
  value       = azurerm_postgresql_flexible_server.this.administrator_login
}

output "administrator_password" {
  description = "Generated admin password."
  value       = random_password.admin.result
  sensitive   = true
}

output "database_url" {
  description = "postgres:// connection string for the app database (TLS required)."
  value = format(
    "postgres://%s:%s@%s:5432/%s?sslmode=require",
    azurerm_postgresql_flexible_server.this.administrator_login,
    urlencode(random_password.admin.result),
    azurerm_postgresql_flexible_server.this.fqdn,
    azurerm_postgresql_flexible_server_database.app.name,
  )
  sensitive = true
}

output "sku_name" {
  description = "Compute SKU of the server."
  value       = azurerm_postgresql_flexible_server.this.sku_name
}

output "postgres_version" {
  description = "PostgreSQL major version."
  value       = azurerm_postgresql_flexible_server.this.version
}

output "public_network_access_enabled" {
  description = "Whether the public endpoint is enabled (always false: VNet-integrated)."
  value       = azurerm_postgresql_flexible_server.this.public_network_access_enabled
}
