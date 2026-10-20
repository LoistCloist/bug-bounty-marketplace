# Offline module test with mock providers: container wiring, sidecar, tags.

mock_provider "azurerm" {
  mock_resource "azurerm_container_app_environment" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-bbm-test-eus2/providers/Microsoft.App/managedEnvironments/cae-bbm-run-1-1"
    }
  }
}

mock_provider "random" {}

variables {
  env_name                   = "run-1-1"
  environment_name           = "cae-bbm-run-1-1"
  resource_group_name        = "rg-bbm-test-eus2"
  location                   = "eastus2"
  log_analytics_workspace_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-bbm-shared-eus2/providers/Microsoft.OperationalInsights/workspaces/log-bbm-shared-eus2"
  acr_login_server           = "acrbbma1b2.azurecr.io"
  pull_identity_id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-bbm-shared-eus2/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-bbm-aca-pull"
  api_image                  = "acrbbma1b2.azurecr.io/bbm/api:sha-abc1234"
  web_image                  = "acrbbma1b2.azurecr.io/bbm/web:sha-abc1234"
  analysis_image             = "acrbbma1b2.azurecr.io/bbm/analysis:sha-abc1234"
  postgres_image             = "acrbbma1b2.azurecr.io/mirror/postgres:16-alpine"
  tags                       = { ephemeral = "true", expires_on = "2026-10-19T06:00:00Z" }
}

run "wiring" {
  command = apply

  assert {
    condition     = azurerm_container_app_environment.this.log_analytics_workspace_id == var.log_analytics_workspace_id && azurerm_container_app_environment.this.logs_destination == "log-analytics"
    error_message = "environment must ship logs to the given LAW"
  }

  assert {
    condition = (
      length(azurerm_container_app.api.template[0].container) == 2 &&
      one([for c in azurerm_container_app.api.template[0].container : c.image if c.name == "postgres"]) == var.postgres_image
    )
    error_message = "api app must run exactly api + postgres sidecar"
  }

  assert {
    condition     = azurerm_container_app.api.template[0].min_replicas == 1 && azurerm_container_app.api.template[0].max_replicas == 1
    error_message = "api (with its sidecar DB) must be pinned to one replica"
  }

  assert {
    condition = one([
      for e in one([for c in azurerm_container_app.api.template[0].container : c if c.name == "api"]).env : e.secret_name if e.name == "DATABASE_URL"
    ]) == "database-url"
    error_message = "DATABASE_URL must come from the database-url secret"
  }

  assert {
    condition     = strcontains(nonsensitive(one([for s in azurerm_container_app.api.secret : s.value if s.name == "database-url"])), "@localhost:5432/bbm")
    error_message = "DATABASE_URL must target the localhost sidecar"
  }

  assert {
    condition = one([
      for e in azurerm_container_app.web.template[0].container[0].env : e.value if e.name == "API_INTERNAL_URL"
    ]) == "https://${azurerm_container_app.api.ingress[0].fqdn}"
    error_message = "web API_INTERNAL_URL must point at the api app's FQDN"
  }

  assert {
    condition     = azurerm_container_app.api.ingress[0].target_port == 3001 && azurerm_container_app.web.ingress[0].target_port == 3000
    error_message = "ingress target ports wrong"
  }

  assert {
    condition     = azurerm_container_app.api.ingress[0].external_enabled && !azurerm_container_app.api.ingress[0].allow_insecure_connections
    error_message = "api ingress must be external and HTTPS-only"
  }

  assert {
    condition     = azurerm_container_app.web.registry[0].identity == var.pull_identity_id && contains(azurerm_container_app.web.identity[0].identity_ids, var.pull_identity_id)
    error_message = "apps must pull with id-bbm-aca-pull"
  }

  assert {
    condition     = azurerm_container_app.web.tags["expires_on"] == "2026-10-19T06:00:00Z" && azurerm_container_app_environment.this.tags["ephemeral"] == "true"
    error_message = "tags not propagated"
  }

  assert {
    condition     = length(azurerm_container_app.analysis) == 0
    error_message = "analysis off by default"
  }
}

run "analysis_enabled" {
  command = plan

  variables {
    analysis_enabled = true
  }

  assert {
    condition     = length(azurerm_container_app.analysis) == 1 && !azurerm_container_app.analysis[0].ingress[0].external_enabled
    error_message = "analysis must use internal ingress"
  }
}
