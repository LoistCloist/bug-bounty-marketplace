terraform {
  required_version = ">= 1.9, < 2.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }

  # Partial config: envs/<kind>/backend.hcl + key=$TF_STATE_KEY (scripts/tf.sh),
  # e.g. test/run-<run_id>-<attempt>.tfstate or preview/pr-<n>.tfstate.
  backend "azurerm" {}
}
