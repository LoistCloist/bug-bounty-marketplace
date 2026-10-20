# terraform test for the naming module (no providers needed — pure locals).

variables {
  suffix = "a1b2"
}

run "global_names" {
  command = plan

  assert {
    condition     = output.global.shared_resource_group == "rg-bbm-shared-eus2"
    error_message = "unexpected shared RG name"
  }

  assert {
    condition     = output.global.acr == "acrbbma1b2"
    error_message = "unexpected ACR name"
  }

  assert {
    condition     = output.global.tfstate_storage_account == "stbbmtfstatea1b2"
    error_message = "unexpected tfstate storage account name"
  }

  assert {
    condition     = output.global.shared_key_vault == "kv-bbm-shared-a1b2"
    error_message = "unexpected shared Key Vault name"
  }

  assert {
    condition     = output.tags.layer == "global" && output.tags.project == "bbm" && output.tags.managed_by == "terraform"
    error_message = "unexpected global tags"
  }

  assert {
    condition     = !contains(keys(output.tags), "ephemeral")
    error_message = "non-ephemeral tags must not carry ephemeral=true"
  }
}

run "staging_names" {
  command = plan

  variables {
    env   = "staging"
    layer = "data"
  }

  assert {
    condition     = output.env.data_resource_group == "rg-bbm-staging-data-eus2"
    error_message = "unexpected staging data RG name"
  }

  assert {
    condition     = output.env.aks_node_resource_group == "rg-bbm-staging-aksnodes-eus2"
    error_message = "unexpected AKS node RG name"
  }

  assert {
    condition     = output.env.key_vault == "kv-bbm-stg-a1b2" && output.env.storage_account == "stbbmstga1b2"
    error_message = "unexpected staging KV/storage names"
  }

  assert {
    condition     = output.env.ingress_fqdn == "bbm-staging.eastus2.cloudapp.azure.com"
    error_message = "unexpected ingress FQDN"
  }

  assert {
    condition     = output.env.vnet_cidr == "10.20.0.0/16" && output.uamis.api == "id-bbm-staging-api"
    error_message = "unexpected VNet CIDR or UAMI name"
  }
}

run "length_limits" {
  command = plan

  # Worst case for length: the longest env name and a longer region code.
  variables {
    env           = "preview"
    location_abbr = "wus3"
    suffix        = "zz99"
  }

  assert {
    condition = alltrue([
      for n in [output.global.shared_key_vault, output.env.key_vault] :
      length(n) >= 3 && length(n) <= 24 && can(regex("^[a-z][a-z0-9-]*[a-z0-9]$", n)) && !strcontains(n, "--")
    ])
    error_message = "Key Vault names must be 3-24 chars, start with a letter, no consecutive hyphens"
  }

  assert {
    condition = alltrue([
      for n in [output.global.tfstate_storage_account, output.env.storage_account] :
      can(regex("^[a-z0-9]{3,24}$", n))
    ])
    error_message = "storage account names must be 3-24 lowercase alphanumeric chars"
  }

  assert {
    condition     = can(regex("^[a-z0-9]{5,50}$", output.global.acr))
    error_message = "ACR name must be 5-50 alphanumeric chars"
  }
}

run "ephemeral_tags" {
  command = plan

  variables {
    env                = "test"
    layer              = "ephemeral"
    ephemeral_env_name = "run-123-1"
    expires_on         = "2026-10-20T00:00:00Z"
  }

  assert {
    condition     = output.aca_environment == "cae-bbm-run-123-1"
    error_message = "unexpected ACA environment name"
  }

  assert {
    condition     = output.tags.ephemeral == "true" && output.tags.expires_on == "2026-10-20T00:00:00Z" && output.tags.layer == "ephemeral"
    error_message = "ephemeral tags missing"
  }
}

run "rejects_bad_suffix" {
  command = plan

  variables {
    suffix = "ABCDE"
  }

  expect_failures = [var.suffix]
}
