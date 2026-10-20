# Ephemeral BBM environment on Azure Container Apps for pipeline test runs
# (kind = test, env_name = run-<run_id>-<attempt>) and PR previews
# (kind = preview, env_name = pr-<n>). Each instance has its own state key, so
# any number can exist at once. Shared inputs (ACR, LAW, pull identity, suffix)
# come from the global stack's state. The RGs belong to stacks/bootstrap.

data "terraform_remote_state" "global" {
  backend = "azurerm"

  config = {
    resource_group_name  = var.tfstate_resource_group
    storage_account_name = var.tfstate_account
    container_name       = "tfstate"
    key                  = "global.tfstate"
    use_oidc             = true
    use_azuread_auth     = true
  }
}

locals {
  global = data.terraform_remote_state.global.outputs

  acr_login_server = coalesce(var.acr_login_server, local.global.acr_login_server)
  web_image_tag    = coalesce(var.web_image_tag, var.image_tag)
  postgres_image   = coalesce(var.postgres_image, "${local.acr_login_server}/mirror/postgres:16-alpine")
  ttl_hours        = coalesce(var.ttl_hours, var.kind == "test" ? 6 : 168)

  # Previews scale web to zero when idle; test runs keep one warm replica.
  web_min_replicas = var.kind == "test" ? 1 : 0

  expires_on = timeadd(time_static.created.rfc3339, "${local.ttl_hours}h")
}

# Fixed timestamp stored in state (plantimestamp() would diff on every plan).
# Re-stamped whenever the deployed images or TTL change, so a preview that
# keeps getting pushes keeps pushing its expiry out.
resource "time_static" "created" {
  triggers = {
    image_tag     = var.image_tag
    web_image_tag = local.web_image_tag
    ttl_hours     = tostring(local.ttl_hours)
  }
}

module "naming" {
  source = "../../modules/naming"

  env                = var.kind
  layer              = "ephemeral"
  location           = var.location
  location_abbr      = var.location_abbr
  suffix             = local.global.suffix
  ephemeral_env_name = var.env_name
  expires_on         = local.expires_on
}

data "azurerm_resource_group" "this" {
  name = module.naming.env.ephemeral_resource_group
}

module "apps" {
  source = "../../modules/aca-app-stack"

  env_name                   = var.env_name
  environment_name           = module.naming.aca_environment
  resource_group_name        = data.azurerm_resource_group.this.name
  location                   = var.location
  log_analytics_workspace_id = local.global.law_id
  acr_login_server           = local.acr_login_server
  pull_identity_id           = local.global.aca_pull_identity_id

  api_image        = "${local.acr_login_server}/bbm/api:${var.image_tag}"
  web_image        = "${local.acr_login_server}/bbm/web:${local.web_image_tag}"
  analysis_image   = "${local.acr_login_server}/bbm/analysis:${var.image_tag}"
  postgres_image   = local.postgres_image
  analysis_enabled = var.analysis_enabled
  web_min_replicas = local.web_min_replicas

  tags = merge(module.naming.tags, { env_name = var.env_name })
}
