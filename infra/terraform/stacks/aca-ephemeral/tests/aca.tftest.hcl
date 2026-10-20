# Offline test with mock providers: no Azure credentials, no backend.
# global.tfstate is replaced by override_data; time_static is pinned so the
# expires_on tag is deterministic.

mock_provider "azurerm" {
  mock_data "azurerm_resource_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-bbm-test-eus2"
    }
  }

  mock_resource "azurerm_container_app_environment" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-bbm-test-eus2/providers/Microsoft.App/managedEnvironments/cae-bbm-mock"
    }
  }
}

mock_provider "random" {}

mock_provider "time" {
  mock_resource "time_static" {
    defaults = {
      rfc3339 = "2026-10-19T00:00:00Z"
    }
  }
}

override_data {
  target = data.terraform_remote_state.global
  values = {
    outputs = {
      acr_login_server     = "acrbbma1b2.azurecr.io"
      law_id               = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-bbm-shared-eus2/providers/Microsoft.OperationalInsights/workspaces/log-bbm-shared-eus2"
      aca_pull_identity_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-bbm-shared-eus2/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-bbm-aca-pull"
      suffix               = "a1b2"
    }
  }
}

variables {
  subscription_id = "00000000-0000-0000-0000-000000000000"
  kind            = "test"
  env_name        = "run-12345678901-1"
  image_tag       = "sha-abc1234"
  tfstate_account = "stbbmtfstatea1b2"
}

run "test_env" {
  command = apply

  assert {
    condition     = output.environment_name == "cae-bbm-run-12345678901-1"
    error_message = "ACA environment must be named cae-bbm-<env_name>"
  }

  assert {
    condition     = output.resource_group == "rg-bbm-test-eus2"
    error_message = "test kind must deploy into rg-bbm-test-eus2"
  }

  assert {
    condition     = module.apps.api_app_name == "run-12345678901-1-api" && module.apps.web_app_name == "run-12345678901-1-web"
    error_message = "app names must be prefixed with env_name"
  }

  assert {
    condition     = module.apps.api_internal_url == "https://${module.apps.api_fqdn}"
    error_message = "web API_INTERNAL_URL must point at the api app"
  }

  assert {
    condition     = module.naming.tags["ephemeral"] == "true" && module.naming.tags["layer"] == "ephemeral"
    error_message = "ephemeral tags missing"
  }

  assert {
    condition     = module.naming.tags["expires_on"] == "2026-10-19T06:00:00Z"
    error_message = "test expiry must be created + 6h"
  }

  assert {
    condition     = local.postgres_image == "acrbbma1b2.azurecr.io/mirror/postgres:16-alpine"
    error_message = "postgres sidecar image must default to the ACR mirror"
  }

  assert {
    condition     = local.web_min_replicas == 1
    error_message = "test env keeps one warm web replica"
  }

  assert {
    condition     = module.apps.analysis_fqdn == null
    error_message = "analysis must be off by default"
  }

  assert {
    condition     = startswith(output.web_url, "https://") && startswith(output.api_url, "https://") && length(output.web_url) > 8 && length(output.api_url) > 8
    error_message = "web_url/api_url must be non-empty https URLs"
  }
}

run "preview_env" {
  command = apply

  variables {
    kind             = "preview"
    env_name         = "pr-42"
    image_tag        = "pr-42-sha-abc1234"
    web_image_tag    = "pr-42-sha-abc1234-mocked"
    analysis_enabled = true
    acr_login_server = "override.azurecr.io"
  }

  assert {
    condition     = output.environment_name == "cae-bbm-pr-42" && output.resource_group == "rg-bbm-preview-eus2"
    error_message = "preview names wrong"
  }

  assert {
    condition     = module.naming.tags["expires_on"] == "2026-10-26T00:00:00Z"
    error_message = "preview expiry must be created + 168h"
  }

  assert {
    condition     = local.web_image_tag == "pr-42-sha-abc1234-mocked" && local.acr_login_server == "override.azurecr.io"
    error_message = "web_image_tag / acr_login_server overrides ignored"
  }

  assert {
    condition     = local.web_min_replicas == 0
    error_message = "previews scale web to zero"
  }

  assert {
    condition     = module.apps.analysis_fqdn != null
    error_message = "analysis_enabled must create the analysis app"
  }
}

run "rejects_bad_kind" {
  command = plan

  variables {
    kind = "staging"
  }

  expect_failures = [var.kind]
}

run "rejects_bad_env_name" {
  command = plan

  variables {
    env_name = "feature-branch"
  }

  expect_failures = [var.env_name]
}

run "rejects_long_env_name" {
  command = plan

  variables {
    env_name = "run-123456789012345678-12"
  }

  expect_failures = [var.env_name]
}

run "rejects_missing_tfstate_account" {
  command = plan

  variables {
    tfstate_account = ""
  }

  expect_failures = [var.tfstate_account]
}

run "rejects_bad_tfstate_account" {
  command = plan

  variables {
    tfstate_account = "St-BBM-tfstate"
  }

  expect_failures = [var.tfstate_account]
}

run "rejects_empty_tfstate_resource_group" {
  command = plan

  variables {
    tfstate_resource_group = ""
  }

  expect_failures = [var.tfstate_resource_group]
}
