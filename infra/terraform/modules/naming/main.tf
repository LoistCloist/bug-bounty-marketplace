# Pure naming/tagging module: no resources, only deterministic strings derived
# from the inputs, so every stack agrees on names without remote lookups.

locals {
  p   = var.project
  loc = var.location_abbr
  sfx = var.suffix

  # Short env codes for names with tight length limits (Key Vault, storage).
  env_short_map = {
    global  = "glb"
    test    = "tst"
    preview = "prv"
    staging = "stg"
    prod    = "prd"
  }
  env_short = local.env_short_map[var.env]

  # VNet address spaces per persistent env (see infra spec).
  vnet_cidrs = {
    staging = "10.20.0.0/16"
    prod    = "10.30.0.0/16"
  }

  # ---- global / shared names ----------------------------------------------
  global = {
    tfstate_resource_group  = "rg-${local.p}-tfstate-${local.loc}"
    tfstate_storage_account = "st${local.p}tfstate${local.sfx}"
    tfstate_container       = "tfstate"
    shared_resource_group   = "rg-${local.p}-shared-${local.loc}"
    acr                     = "acr${local.p}${local.sfx}"
    shared_log_analytics    = "log-${local.p}-shared-${local.loc}"
    aca_pull_identity       = "id-${local.p}-aca-pull"
    shared_key_vault        = "kv-${local.p}-shared-${local.sfx}"
    test_resource_group     = "rg-${local.p}-test-${local.loc}"
    preview_resource_group  = "rg-${local.p}-preview-${local.loc}"
  }

  # ---- per-env names (meaningful for staging/prod) --------------------------
  e = var.env
  env = {
    data_resource_group      = "rg-${local.p}-${local.e}-data-${local.loc}"
    compute_resource_group   = "rg-${local.p}-${local.e}-compute-${local.loc}"
    aks_node_resource_group  = "rg-${local.p}-${local.e}-aksnodes-${local.loc}"
    vnet                     = "vnet-${local.p}-${local.e}-${local.loc}"
    vnet_cidr                = lookup(local.vnet_cidrs, local.e, null)
    subnet_aks               = "snet-aks"
    subnet_psql              = "snet-psql"
    subnet_pe                = "snet-pe"
    postgres_server          = "psql-${local.p}-${local.e}-${local.loc}"
    postgres_database        = local.p
    key_vault                = "kv-${local.p}-${local.env_short}-${local.sfx}"
    storage_account          = "st${local.p}${local.env_short}${local.sfx}"
    storage_container        = "sources"
    storage_queue            = "analysis-jobs"
    log_analytics            = "log-${local.p}-${local.e}-${local.loc}"
    ingress_public_ip        = "pip-${local.p}-${local.e}-ingress"
    ingress_dns_label        = "${local.p}-${local.e}"
    ingress_fqdn             = "${local.p}-${local.e}.${var.location}.cloudapp.azure.com"
    aks_cluster              = "aks-${local.p}-${local.e}-${local.loc}"
    ephemeral_resource_group = "rg-${local.p}-${local.e}-${local.loc}"
  }

  uamis = {
    for role in ["aks", "api", "worker", "sandbox"] : role => "id-${local.p}-${local.e}-${role}"
  }

  # ---- tags -----------------------------------------------------------------
  base_tags = {
    project     = local.p
    env         = var.env
    managed_by  = "terraform"
    repo        = var.repo
    cost_center = "cse416"
  }

  ephemeral_tags = var.expires_on == null ? {} : {
    ephemeral  = "true"
    expires_on = var.expires_on
  }

  tags_by_layer = {
    for l in ["global", "data", "compute", "ephemeral"] :
    l => merge(local.base_tags, { layer = l }, local.ephemeral_tags, var.extra_tags)
  }
}
