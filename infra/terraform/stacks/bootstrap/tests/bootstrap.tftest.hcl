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
    condition     = length(module.github_oidc.client_ids) == 6
    error_message = "expected 6 OIDC identities"
  }

  assert {
    condition     = module.github_oidc.subjects["gh-bbm-prod"] == ["repo:LoistCloist/bug-bounty-marketplace:environment:prod"]
    error_message = "gh-bbm-prod must trust only the reviewer-gated prod environment"
  }

  assert {
    condition     = module.github_oidc.subjects["gh-bbm-prod-power"] == ["repo:LoistCloist/bug-bounty-marketplace:environment:prod-power"]
    error_message = "gh-bbm-prod-power must trust only prod-power"
  }

  assert {
    condition = (
      length(local.oidc_identities["gh-bbm-prod-power"].role_assignments) == 2 &&
      alltrue([for ra in local.oidc_identities["gh-bbm-prod-power"].role_assignments :
      ra.role_definition_id == azurerm_role_definition.power_operator.role_definition_resource_id])
    )
    error_message = "gh-bbm-prod-power must hold only BBM Power Operator (data + compute)"
  }

  assert {
    condition     = contains(module.github_oidc.subjects["gh-bbm-plan"], "repo:LoistCloist/bug-bounty-marketplace:pull_request")
    error_message = "plan identity must trust pull_request"
  }

  assert {
    condition = (
      length(local.oidc_identities["gh-bbm-plan"].role_assignments) == 2 &&
      local.oidc_identities["gh-bbm-plan"].role_assignments[0].role_definition_name == "Reader" &&
      local.oidc_identities["gh-bbm-plan"].role_assignments[1] == local.state_role.plan
    )
    error_message = "plan identity must have only Reader + the (conditioned) BBM tfstate reader"
  }

  # ---- state ABAC --------------------------------------------------------------
  assert {
    condition = alltrue([
      for name, id in local.oidc_identities : alltrue([
        for ra in id.role_assignments : ra.condition != null && ra.condition_version == "2.0"
        if ra.key == "tfstate"
      ])
    ])
    error_message = "every CI state grant must carry an ABAC condition"
  }

  assert {
    condition = (
      strcontains(local.state_condition.prod, "StringStartsWith 'prod/'") &&
      strcontains(local.state_condition.prod, "StringEquals 'global.tfstate'") &&
      !strcontains(local.state_condition.prod, "'staging/'") &&
      strcontains(local.state_path_match.prod.write, "'prod/'") &&
      !strcontains(local.state_path_match.prod.write, "global.tfstate")
    )
    error_message = "prod state condition wrong (write prod/, read prod/ + global.tfstate)"
  }

  assert {
    condition = (
      strcontains(local.state_path_match.ephemeral.write, "StringStartsWith 'test/'") &&
      strcontains(local.state_path_match.ephemeral.write, "StringStartsWith 'preview/'") &&
      strcontains(local.state_path_match.ephemeral.read, "StringEquals 'global.tfstate'")
    )
    error_message = "ephemeral state condition wrong"
  }

  assert {
    condition     = local.state_path_match.global.write == "@Resource[Microsoft.Storage/storageAccounts/blobServices/containers/blobs:path] StringEquals 'global.tfstate'"
    error_message = "global identity may only write global.tfstate"
  }

  assert {
    condition = (
      !strcontains(local.state_condition.plan, "prod/") &&
      !strcontains(local.state_condition.plan, "bootstrap") &&
      !strcontains(local.state_condition.plan, "/write") &&
      strcontains(local.state_condition.plan, "NOT SubOperationMatches{'Blob.List'}")
    )
    error_message = "plan state condition must be read-only and exclude prod/ and bootstrap"
  }

  assert {
    condition = (
      local.state_role_kind == { ephemeral = "writer", global = "writer", staging = "writer", prod = "writer", plan = "reader" } &&
      alltrue([for k, r in local.state_role : r.role_definition_id == azurerm_role_definition.tfstate[local.state_role_kind[k]].role_definition_resource_id])
    )
    error_message = "CI state grants must use the custom BBM tfstate writer/reader roles (plan: reader)"
  }

  # No CI state role may carry container write/delete (the built-in Storage
  # Blob Data roles do, and ABAC blob-path conditions cannot limit them).
  assert {
    condition = alltrue([for k, r in azurerm_role_definition.tfstate : (
      toset(r.permissions[0].actions) == toset(["Microsoft.Storage/storageAccounts/blobServices/containers/read"]) &&
      toset(r.assignable_scopes) == toset([azurerm_resource_group.tfstate.id])
    )])
    error_message = "tfstate custom roles may only hold containers/read as a control-plane action"
  }

  assert {
    condition = (
      azurerm_role_definition.tfstate["writer"].name == "BBM tfstate writer" &&
      toset(azurerm_role_definition.tfstate["writer"].permissions[0].data_actions) == toset([
        for a in ["read", "write", "add/action", "delete", "move/action"] : "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/${a}"
      ]) &&
      azurerm_role_definition.tfstate["reader"].name == "BBM tfstate reader" &&
      toset(azurerm_role_definition.tfstate["reader"].permissions[0].data_actions) == toset(["Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read"])
    )
    error_message = "tfstate custom role data actions wrong"
  }

  assert {
    condition = alltrue(flatten([for name, id in local.oidc_identities : [
      for ra in id.role_assignments : !contains(["Storage Blob Data Contributor", "Storage Blob Data Reader", "Storage Blob Data Owner"], try(ra.role_definition_name, "-"))
    ]]))
    error_message = "CI identities must not hold built-in Storage Blob Data roles"
  }

  # ---- constrained RBAC admin --------------------------------------------------
  assert {
    condition = alltrue([
      for k, c in local.rbac_condition :
      strcontains(c, "@Request[Microsoft.Authorization/roleAssignments:PrincipalType] StringEqualsIgnoreCase 'ServicePrincipal'")
    ])
    error_message = "RBAC admin conditions must restrict new assignments to service principals"
  }

  assert {
    condition = alltrue([for g in ["19e7f393-937e-4f77-808e-94535e297925", "8a0f0c08-91a1-4084-bc3d-661d67233fed", "c6a89b2d-59bc-44d0-9896-0f6e12d7b80a"] :
    contains(local.env_delegable_roles, g)])
    error_message = "env identities must be able to delegate the Storage Queue Data Reader / Message Processor / Message Sender roles"
  }

  assert {
    condition     = azurerm_resource_group.env_data["prod"].tags["power-state"] == "down" && azurerm_resource_group.env_data["prod"].tags["layer"] == "data"
    error_message = "data RG initial tags wrong"
  }

  assert {
    condition     = strcontains(output.gh_setup_commands, "# --- environment: prod-power (gh-bbm-prod-power)")
    error_message = "gh_setup_commands must map prod-power to gh-bbm-prod-power"
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
    condition     = strcontains(output.global_tfvars_hint, "secret_officer_sp_object_ids = [\"77777777-7777-7777-7777-777777777777\"]") && !strcontains(output.global_tfvars_hint, "secret_officer_object_ids")
    error_message = "global_tfvars_hint must emit secret_officer_sp_object_ids with the gh-bbm-global SP"
  }

  assert {
    condition     = jsondecode(local.env_payload["prod"]).reviewers == [{ type = "User", id = 12345 }]
    error_message = "prod payload must carry the configured reviewer"
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

# Without github_reviewer_ids, reviewer-gated envs must not send `reviewers`
# (a re-run would otherwise wipe reviewers added by hand); unattended envs
# still send an explicit empty list.
run "no_reviewer_ids" {
  command = plan

  variables {
    github_reviewer_ids = []
  }

  assert {
    condition = alltrue([
      for env in ["prod", "infra-global", "contracts-sepolia"] : !contains(keys(jsondecode(local.env_payload[env])), "reviewers")
    ])
    error_message = "reviewer-gated env payloads must omit reviewers when github_reviewer_ids is empty"
  }

  assert {
    condition     = jsondecode(local.env_payload["prod-power"]).reviewers == [] && jsondecode(local.env_payload["staging"]).reviewers == []
    error_message = "unattended envs must explicitly clear reviewers"
  }

  assert {
    condition     = strcontains(output.gh_setup_commands, "NOTE: github_reviewer_ids is empty")
    error_message = "missing manual-reviewer note"
  }
}
