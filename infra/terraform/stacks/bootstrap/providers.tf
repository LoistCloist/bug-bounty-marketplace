# Locally (first run) auth falls through OIDC to the Azure CLI (`az login`);
# in CI the ARM_* / ACTIONS_ID_TOKEN_* env vars drive OIDC.
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

provider "azuread" {
  use_oidc = true
}
