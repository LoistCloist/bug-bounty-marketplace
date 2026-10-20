terraform {
  required_version = ">= 1.9, < 2.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Chicken-and-egg: this stack creates the state storage account, so the very
  # first apply uses the implicit LOCAL backend. Afterwards, migrate:
  #   1. Uncomment the block below.
  #   2. Put the storage account name (output tfstate_storage_account) into
  #      envs/global/backend.hcl.
  #   3. ./scripts/tf.sh bootstrap global init -migrate-state
  #   4. Delete the local terraform.tfstate* files once the migration succeeds.
  # scripts/tf.sh detects this block and only passes -backend-config when it is
  # active. Settings come from envs/global/backend.hcl + key=bootstrap.tfstate.
  #
  # backend "azurerm" {}
}
