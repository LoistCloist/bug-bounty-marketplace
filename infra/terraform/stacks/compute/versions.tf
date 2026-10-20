terraform {
  required_version = ">= 1.9, < 2.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  # Partial config: envs/<env>/backend-compute.hcl + key=<env>/compute.tfstate (scripts/tf.sh).
  backend "azurerm" {}
}
