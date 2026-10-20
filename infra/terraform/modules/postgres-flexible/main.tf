# Private (VNet-integrated) PostgreSQL Flexible Server for one env.
#
# Power: the env-power workflow (scripts/env-power.sh) stops/starts this server
# out-of-band with `az postgres flexible-server stop|start`. Terraform does not
# track the running state. Azure auto-starts a stopped server after 7 days, so
# env-power re-pauses it daily while the env is paused/down.

# Alphanumeric plus URL-unreserved specials, so the password can be embedded
# in DATABASE_URL without ambiguity (it is still urlencode()d there).
resource "random_password" "admin" {
  length           = 32
  special          = true
  override_special = "-_~"
  min_upper        = 2
  min_lower        = 2
  min_numeric      = 2
  min_special      = 1
}

resource "azurerm_postgresql_flexible_server" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  version             = var.postgres_version
  sku_name            = var.sku_name
  storage_mb          = var.storage_mb
  auto_grow_enabled   = false

  backup_retention_days        = var.backup_retention_days
  geo_redundant_backup_enabled = false
  # No high_availability block: a single zonal server keeps cost minimal.

  delegated_subnet_id           = var.delegated_subnet_id
  private_dns_zone_id           = var.private_dns_zone_id
  public_network_access_enabled = false

  administrator_login    = var.administrator_login
  administrator_password = random_password.admin.result

  tags = var.tags

  lifecycle {
    # Azure picks the zone when unset and may move it on failover; changing it
    # would force a replacement of the server (and its data).
    ignore_changes = [
      zone,
      high_availability[0].standby_availability_zone,
    ]
  }
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = var.database_name
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}
