# CI authenticates via GitHub OIDC (ARM_CLIENT_ID/ARM_TENANT_ID + ACTIONS_ID_TOKEN_*);
# locally auth falls through to the Azure CLI (`az login`).
provider "azurerm" {
  subscription_id                 = var.subscription_id
  use_oidc                        = true
  storage_use_azuread             = true
  resource_provider_registrations = "none"

  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
  }
}
