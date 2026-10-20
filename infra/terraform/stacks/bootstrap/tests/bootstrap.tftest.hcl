# Offline test with mock providers: no Azure/Entra credentials needed.
# Exercises for_each keys, ABAC conditions and the gh_setup_commands output.

mock_provider "azurerm" {
  mock_data "azurerm_subscription" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000"
    }
  }

  mock_data "azurerm_client_config" {
    defaults = {
      tenant_id = "11111111-1111-1111-1111-111111111111"
      object_id = "22222222-2222-2222-2222-222222222222"
    }
  }

  mock_resource "azurerm_resource_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/mock"
    }
  }

  mock_resource "azurerm_storage_account" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-bbm-tfstate-eus2/providers/Microsoft.Storage/storageAccounts/mock"
    }
  }

  mock_resource "azurerm_role_definition" {
    defaults = {
      role_definition_resource_id = "/subscriptions/00000000-0000-0000-0000-000000000000/providers/Microsoft.Authorization/roleDefinitions/33333333-3333-3333-3333-333333333333"
    }
  }
}

mock_provider "azuread" {
  mock_data "azuread_client_config" {
    defaults = {
      object_id = "22222222-2222-2222-2222-222222222222"
    }
  }

  mock_resource "azuread_application_registration" {
    defaults = {
      id        = "/applications/66666666-6666-6666-6666-666666666666"
      client_id = "44444444-4444-4444-4444-444444444444"
    }
  }

  mock_resource "azuread_service_principal" {
    defaults = {
      object_id = "77777777-7777-7777-7777-777777777777"
    }
  }
}

mock_provider "random" {
  mock_resource "random_string" {
    defaults = {
      result = "a1b2"
    }
  }
}

variables {
  subscription_id           = "00000000-0000-0000-0000-000000000000"
  alert_emails              = ["admin@example.com"]
  admin_object_ids          = ["55555555-5555-5555-5555-555555555555"]
  power_operator_object_ids = ["55555555-5555-5555-5555-555555555555"]
  github_reviewer_ids       = [12345]
}

run "apply_with_mocks" {
  command = apply

  assert {
    condition     = length(module.github_oidc.client_ids) == 5
    error_message = "expected 5 OIDC identities"
  }

  assert {
    condition = toset(module.github_oidc.subjects["gh-bbm-prod"]) == toset([
      "repo:LoistCloist/bug-bounty-marketplace:environment:prod",
      "repo:LoistCloist/bug-bounty-marketplace:environment:prod-power",
    ])
    error_message = "unexpected prod federated subjects"
  }

  assert {
    condition     = contains(module.github_oidc.subjects["gh-bbm-plan"], "repo:LoistCloist/bug-bounty-marketplace:pull_request")
    error_message = "plan identity must trust pull_request"
  }

  assert {
    condition     = azurerm_resource_group.env_data["prod"].tags["power-state"] == "down" && azurerm_resource_group.env_data["prod"].tags["layer"] == "data"
    error_message = "data RG initial tags wrong"
  }

  assert {
    condition     = strcontains(output.gh_setup_commands, "gh variable set AZURE_CLIENT_ID --repo LoistCloist/bug-bounty-marketplace --env prod-power")
    error_message = "gh_setup_commands missing prod-power client id"
  }

  assert {
    condition     = strcontains(output.gh_setup_commands, "repos/LoistCloist/bug-bounty-marketplace/environments/infra-global/deployment-branch-policies")
    error_message = "gh_setup_commands missing infra-global branch policy"
  }

  assert {
    condition     = length(azurerm_resource_provider_registration.this) == 15
    error_message = "expected 15 resource provider registrations"
  }

  assert {
    condition     = length(azurerm_role_assignment.power_operator) == 4 && length(azurerm_role_assignment.admin_aks) == 2
    error_message = "unexpected human role assignment count"
  }
}
