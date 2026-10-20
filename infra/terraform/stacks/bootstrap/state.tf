# Remote state storage for every stack. Entra-only auth (no shared keys), so
# backends must set use_azuread_auth = true and callers need a Storage Blob
# Data role on the container.

resource "azurerm_resource_group" "tfstate" {
  name     = module.naming.global.tfstate_resource_group
  location = var.location
  tags     = module.naming.tags
}

resource "azurerm_storage_account" "tfstate" {
  name                            = module.naming.global.tfstate_storage_account
  resource_group_name             = azurerm_resource_group.tfstate.name
  location                        = var.location
  account_kind                    = "StorageV2"
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  shared_access_key_enabled       = false
  default_to_oauth_authentication = true
  allow_nested_items_to_be_public = false
  tags                            = module.naming.tags

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 14
    }

    container_delete_retention_policy {
      days = 14
    }
  }

  depends_on = [azurerm_resource_provider_registration.this]
}

# Guards the state account against accidental deletion (portal, CLI or a
# stray destroy). Remove the lock deliberately before tearing everything down.
resource "azurerm_management_lock" "tfstate" {
  name       = "lock-bbm-tfstate"
  scope      = azurerm_storage_account.tfstate.id
  lock_level = "CanNotDelete"
  notes      = "Terraform state for all BBM stacks. Do not delete."
}

# storage_account_id => created via the ARM control plane (no data-plane auth needed).
resource "azurerm_storage_container" "tfstate" {
  name                  = module.naming.global.tfstate_container
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"
}

locals {
  tfstate_container_scope = "${azurerm_storage_account.tfstate.id}/blobServices/default/containers/${azurerm_storage_container.tfstate.name}"
}

# The human running bootstrap (and admins) need data-plane access to migrate
# and inspect state.
resource "azurerm_role_assignment" "tfstate_humans" {
  for_each = toset(concat([data.azurerm_client_config.current.object_id], var.admin_object_ids))

  scope                = local.tfstate_container_scope
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = each.key
}
