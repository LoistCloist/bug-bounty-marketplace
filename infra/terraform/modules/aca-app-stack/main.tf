# One ephemeral BBM deployment on Azure Container Apps (Consumption, no VNet):
#   <env_name>-api       api + Postgres sidecar on localhost:5432 (min = max = 1)
#   <env_name>-web       Next.js frontend, server-side calls go to the api
#   <env_name>-analysis  optional analysis worker, internal ingress only
# Container app names are unique per resource group, and many environments
# share rg-bbm-<kind>-eus2, so every app name carries the env_name prefix.

locals {
  app_names = {
    api      = "${var.env_name}-api"
    web      = "${var.env_name}-web"
    analysis = "${var.env_name}-analysis"
  }

  pg_user = "bbm"
  pg_db   = "bbm"

  # Within one environment, apps reach each other through the environment's
  # Envoy proxy and traffic never leaves the environment. We use the api's
  # ingress FQDN over HTTPS rather than the short form http://<app name>:
  # with allow_insecure_connections = false the proxy answers plain HTTP with
  # a redirect to HTTPS, which would turn server-side POSTs into GETs. The FQDN
  # has a valid platform certificate.
  api_internal_url = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}

resource "azurerm_container_app_environment" "this" {
  name                       = var.environment_name
  resource_group_name        = var.resource_group_name
  location                   = var.location
  logs_destination           = "log-analytics"
  log_analytics_workspace_id = var.log_analytics_workspace_id
  tags                       = var.tags
}

# Throwaway credentials for the sidecar database; it dies with the app.
resource "random_password" "postgres" {
  length  = 32
  special = false
}

resource "azurerm_container_app" "api" {
  name                         = local.app_names.api
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.this.id
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.pull_identity_id]
  }

  registry {
    server   = var.acr_login_server
    identity = var.pull_identity_id
  }

  secret {
    name  = "pg-password"
    value = random_password.postgres.result
  }

  secret {
    name  = "database-url"
    value = "postgres://${local.pg_user}:${random_password.postgres.result}@localhost:5432/${local.pg_db}"
  }

  ingress {
    external_enabled           = true
    target_port                = 3001
    transport                  = "auto"
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    # The database lives in this replica: never scale out or to zero.
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "api"
      image  = var.api_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name  = "PORT"
        value = "3001"
      }
      env {
        name  = "SOURCE_STORAGE_DIR"
        value = "/tmp/sources"
      }
      env {
        name  = "MIGRATE_ON_BOOT"
        value = "true"
      }

      # The api exits if Postgres is not up yet; ACA restarts it. The startup
      # probe gives it ~100 s before ACA restarts the container.
      startup_probe {
        transport               = "HTTP"
        port                    = 3001
        path                    = "/health"
        initial_delay           = 3
        interval_seconds        = 10
        timeout                 = 3
        failure_count_threshold = 10
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = 3001
        path                    = "/health"
        interval_seconds        = 10
        timeout                 = 3
        failure_count_threshold = 3
        success_count_threshold = 1
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = 3001
        path                    = "/health"
        interval_seconds        = 15
        timeout                 = 5
        failure_count_threshold = 3
      }
    }

    # Postgres sidecar: same replica, so the api reaches it on localhost.
    container {
      name   = "postgres"
      image  = var.postgres_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "POSTGRES_USER"
        value = local.pg_user
      }
      env {
        name        = "POSTGRES_PASSWORD"
        secret_name = "pg-password"
      }
      env {
        name  = "POSTGRES_DB"
        value = local.pg_db
      }

      liveness_probe {
        transport               = "TCP"
        port                    = 5432
        initial_delay           = 10
        interval_seconds        = 15
        failure_count_threshold = 3
      }
    }
  }
}

resource "azurerm_container_app" "web" {
  name                         = local.app_names.web
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.this.id
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.pull_identity_id]
  }

  registry {
    server   = var.acr_login_server
    identity = var.pull_identity_id
  }

  ingress {
    external_enabled           = true
    target_port                = 3000
    transport                  = "auto"
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.web_min_replicas
    max_replicas = 2

    container {
      name   = "web"
      image  = var.web_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "API_INTERNAL_URL"
        value = local.api_internal_url
      }
      env {
        name  = "PORT"
        value = "3000"
      }
      env {
        name  = "HOSTNAME"
        value = "0.0.0.0"
      }

      startup_probe {
        transport               = "HTTP"
        port                    = 3000
        path                    = "/healthz"
        initial_delay           = 3
        interval_seconds        = 10
        timeout                 = 3
        failure_count_threshold = 10
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = 3000
        path                    = "/healthz"
        interval_seconds        = 10
        timeout                 = 3
        failure_count_threshold = 3
        success_count_threshold = 1
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = 3000
        path                    = "/healthz"
        interval_seconds        = 15
        timeout                 = 5
        failure_count_threshold = 3
      }
    }
  }
}

resource "azurerm_container_app" "analysis" {
  count = var.analysis_enabled ? 1 : 0

  name                         = local.app_names.analysis
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.this.id
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.pull_identity_id]
  }

  registry {
    server   = var.acr_login_server
    identity = var.pull_identity_id
  }

  # Internal: reachable only from other apps in this environment.
  ingress {
    external_enabled           = false
    target_port                = 8000
    transport                  = "auto"
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 0
    max_replicas = 1

    container {
      name   = "analysis"
      image  = var.analysis_image
      cpu    = 0.25
      memory = "0.5Gi"

      startup_probe {
        transport               = "HTTP"
        port                    = 8000
        path                    = "/health"
        initial_delay           = 3
        interval_seconds        = 10
        timeout                 = 3
        failure_count_threshold = 10
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = 8000
        path                    = "/health"
        interval_seconds        = 10
        timeout                 = 3
        failure_count_threshold = 3
        success_count_threshold = 1
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = 8000
        path                    = "/health"
        interval_seconds        = 15
        timeout                 = 5
        failure_count_threshold = 3
      }
    }
  }
}
