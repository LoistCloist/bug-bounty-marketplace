# Env storage account: blob container for contract sources + analysis job queue.
#
# Shared keys are disabled, so every client (apps and Terraform) uses Entra ID.
# The container and queue are created with storage_account_id, i.e. through the
# ARM control plane, so Terraform needs no data-plane role to create them (the
# provider also sets storage_use_azuread = true for any data-plane calls).
# The queue_properties block is deliberately not used: it is data-plane only.

resource "azurerm_storage_account" "this" {
  name                     = var.name
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_kind             = "StorageV2"
  account_tier             = "Standard"
  account_replication_type = "LRS"

  shared_access_key_enabled        = false
  default_to_oauth_authentication  = true
  min_tls_version                  = "TLS1_2"
  https_traffic_only_enabled       = true
  allow_nested_items_to_be_public  = false
  cross_tenant_replication_enabled = false

  blob_properties {
    delete_retention_policy {
      days = var.soft_delete_days
    }

    container_delete_retention_policy {
      days = var.soft_delete_days
    }
  }

  tags = var.tags
}

resource "azurerm_storage_container" "sources" {
  name                  = var.container_name
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}

resource "azurerm_storage_queue" "jobs" {
  name               = var.queue_name
  storage_account_id = azurerm_storage_account.this.id
}
