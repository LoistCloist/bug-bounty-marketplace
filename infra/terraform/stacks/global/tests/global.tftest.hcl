# Offline test with a mock azurerm provider (no credentials, no backend).

mock_provider "azurerm" {
  mock_data "azurerm_client_config" {
    defaults = {
      tenant_id = "11111111-1111-1111-1111-111111111111"
    }
  }

  mock_data "azurerm_resource_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/mock"
    }
  }

  mock_resource "azurerm_container_registry" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-bbm-shared-eus2/providers/Microsoft.ContainerRegistry/registries/acrbbma1b2"
    }
  }

  mock_resource "azurerm_log_analytics_workspace" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-bbm-shared-eus2/providers/Microsoft.OperationalInsights/workspaces/log-bbm-shared-eus2"
    }
  }

  mock_resource "azurerm_key_vault" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-bbm-shared-eus2/providers/Microsoft.KeyVault/vaults/kv-bbm-shared-a1b2"
    }
  }

  mock_resource "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-bbm-shared-eus2/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-bbm-aca-pull"
      principal_id = "88888888-8888-8888-8888-888888888888"
    }
  }
}

variables {
  subscription_id           = "00000000-0000-0000-0000-000000000000"
  suffix                    = "a1b2"
  alert_emails              = ["admin@example.com"]
  ephemeral_ci_principal_id = "77777777-7777-7777-7777-777777777777"
  secret_officer_object_ids = ["99999999-9999-9999-9999-999999999999"]
}

run "plan_names" {
  command = plan

  assert {
    condition     = azurerm_key_vault.shared.name == "kv-bbm-shared-a1b2" && azurerm_key_vault.shared.rbac_authorization_enabled
    error_message = "shared KV name/RBAC mode wrong"
  }

  assert {
    condition     = module.acr.name == "acrbbma1b2"
    error_message = "ACR name wrong"
  }

  assert {
    condition     = length(module.rg_budget) == 4
    error_message = "expected 4 RG budgets (staging/prod x data/compute)"
  }

  assert {
    condition     = length(azurerm_key_vault_secret.placeholder) == 3
    error_message = "expected 3 placeholder secrets"
  }
}

run "apply_with_mocks" {
  command = apply

  assert {
    condition     = length(azurerm_role_assignment.ephemeral_ci) == 3
    error_message = "expected AcrPush, MI Operator and LAW grants for the ephemeral identity"
  }

  assert {
    condition     = output.aca_pull_identity_id != "" && output.suffix == "a1b2"
    error_message = "outputs missing"
  }
}
