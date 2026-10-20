terraform {
  required_version = ">= 1.9, < 2.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 4.42, < 5.0"
    }
  }

  # Partial config: envs/global/backend.hcl + key=global.tfstate (scripts/tf.sh).
  backend "azurerm" {}
}
