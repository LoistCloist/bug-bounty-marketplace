# GitHub Actions OIDC identities and their RBAC. See the infra spec
# "GitHub Environments / OIDC" section for the authoritative matrix.

locals {
  # Built-in role definition GUIDs that CI identities may hand out through the
  # ABAC-constrained "Role Based Access Control Administrator" role. Never
  # include Owner / User Access Administrator / RBAC Administrator here.
  role_guids = {
    acr_pull                    = "7f951dda-4ed3-4680-a7ca-43fe172d538d"
    acr_push                    = "8311e382-0749-4cb8-b61a-304f252e45ec"
    aks_rbac_cluster_admin      = "b1ff04bb-8a4e-4dc4-8eb5-8693973ce19b"
    aks_rbac_writer             = "a7ffa36f-339b-4b5c-8bdf-e2c188b2c0eb"
    kv_secrets_officer          = "b86a8fe4-44ce-4948-aee5-eccb2c155cd7"
    kv_secrets_user             = "4633458b-17de-408a-b874-0445c86b69e6"
    log_analytics_contributor   = "92aaf0da-9dab-42b6-94a3-d43ce8d16293"
    managed_identity_operator   = "f1a07417-d97a-45cb-824c-7a7467783830"
    monitoring_metrics_pub      = "3913510d-42f4-4e42-8a64-420c390055eb"
    network_contributor         = "4d97b98b-1d4f-4787-a291-c67834d212e7"
    private_dns_zone_contrib    = "b12aa53e-6015-4669-85d0-8515ebb3ae7f"
    storage_blob_data_contrib   = "ba92f5b4-2d11-453d-a403-e96b0029c9fe"
    storage_blob_data_reader    = "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1"
    storage_queue_data_contrib  = "974c5e8b-45b9-4653-ba55-5f855dd0fb88"
    storage_queue_msg_processor = "8a0f0c08-91a1-4084-bc3d-661d67233fed"
    storage_queue_msg_sender    = "c6a89b2d-59bc-44d0-9896-0f6e12d7b80a"
  }

  # Roles the env (staging/prod) identities may assign inside their own RGs:
  # workload identities -> KV/storage/queue, AKS identity -> network/DNS/MI.
  env_delegable_roles = [for k in [
    "acr_pull", "aks_rbac_cluster_admin", "aks_rbac_writer", "kv_secrets_officer", "kv_secrets_user",
    "managed_identity_operator", "monitoring_metrics_pub", "network_contributor", "private_dns_zone_contrib",
    "storage_blob_data_contrib", "storage_blob_data_reader", "storage_queue_data_contrib",
    "storage_queue_msg_processor", "storage_queue_msg_sender",
  ] : local.role_guids[k]]

  # Roles the global identity may assign inside the shared RG (ACA pull UAMI
  # -> AcrPull, ephemeral CI -> AcrPush / MI Operator / LAW, KV readers).
  global_delegable_roles = [for k in [
    "acr_pull", "acr_push", "managed_identity_operator", "log_analytics_contributor",
    "kv_secrets_officer", "kv_secrets_user",
  ] : local.role_guids[k]]

  # Env identities may only grant AcrPull (kubelet identity) in the shared RG.
  shared_acr_pull_only = [local.role_guids.acr_pull]

  # ABAC condition: role assignment writes/deletes are only allowed for the
  # listed role definitions.
  rbac_condition = { for k, guids in {
    env    = local.env_delegable_roles
    global = local.global_delegable_roles
    shared = local.shared_acr_pull_only
    } : k => join(" ", [
      "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR",
      "(@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {${join(", ", guids)}}))",
      "AND",
      "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR",
      "(@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {${join(", ", guids)}}))",
  ]) }

  rg_ids = {
    shared  = azurerm_resource_group.shared.id
    test    = azurerm_resource_group.ephemeral["test"].id
    preview = azurerm_resource_group.ephemeral["preview"].id
  }

  state_writer = {
    key                  = "tfstate"
    scope                = local.tfstate_container_scope
    role_definition_name = "Storage Blob Data Contributor"
  }

  # Grants shared by gh-bbm-staging and gh-bbm-prod, parameterised by env.
  env_identity_roles = { for env in local.persistent_envs : env => [
    { key = "data-contributor", scope = azurerm_resource_group.env_data[env].id, role_definition_name = "Contributor" },
    { key = "compute-contributor", scope = azurerm_resource_group.env_compute[env].id, role_definition_name = "Contributor" },
    {
      key                  = "data-rbac-admin"
      scope                = azurerm_resource_group.env_data[env].id
      role_definition_name = "Role Based Access Control Administrator"
      condition            = local.rbac_condition.env
      condition_version    = "2.0"
    },
    {
      key                  = "compute-rbac-admin"
      scope                = azurerm_resource_group.env_compute[env].id
      role_definition_name = "Role Based Access Control Administrator"
      condition            = local.rbac_condition.env
      condition_version    = "2.0"
    },
    { key = "compute-aks-admin", scope = azurerm_resource_group.env_compute[env].id, role_definition_name = "Azure Kubernetes Service RBAC Cluster Admin" },
    # Data stack creates the env Key Vault + placeholder secrets.
    { key = "data-kv-secrets", scope = azurerm_resource_group.env_data[env].id, role_definition_name = "Key Vault Secrets Officer" },
    # Read ACR / LAW / UAMIs in the shared RG and grant the kubelet AcrPull.
    { key = "shared-reader", scope = local.rg_ids.shared, role_definition_name = "Reader" },
    {
      key                  = "shared-acrpull-admin"
      scope                = local.rg_ids.shared
      role_definition_name = "Role Based Access Control Administrator"
      condition            = local.rbac_condition.shared
      condition_version    = "2.0"
    },
    local.state_writer,
  ] }
}

# Custom role for on-demand power management (az aks stop/start,
# az postgres flexible-server stop/start, power-state tags).
resource "azurerm_role_definition" "power_operator" {
  name        = "BBM Power Operator"
  scope       = local.subscription_scope
  description = "Pause/resume BBM AKS clusters and PostgreSQL flexible servers and update power-state tags."

  permissions {
    actions = [
      "Microsoft.ContainerService/managedClusters/read",
      "Microsoft.ContainerService/managedClusters/start/action",
      "Microsoft.ContainerService/managedClusters/stop/action",
      "Microsoft.DBforPostgreSQL/flexibleServers/read",
      "Microsoft.DBforPostgreSQL/flexibleServers/start/action",
      "Microsoft.DBforPostgreSQL/flexibleServers/stop/action",
      "Microsoft.Resources/subscriptions/resourceGroups/read",
      "Microsoft.Resources/tags/read",
      "Microsoft.Resources/tags/write",
    ]
  }

  assignable_scopes = [local.subscription_scope]
}

module "github_oidc" {
  source = "../../modules/github-oidc"

  repo = var.github_repo

  identities = {
    # Read-only plan identity for PRs and main. It only READS state, so plan
    # jobs must run with -lock=false.
    "gh-bbm-plan" = {
      extra_subjects = ["pull_request", "ref:refs/heads/main"]
      role_assignments = [
        { key = "sub-reader", scope = local.subscription_scope, role_definition_name = "Reader" },
        # Refreshing azurerm_key_vault_secret reads secret values.
        { key = "sub-kv-secrets-user", scope = local.subscription_scope, role_definition_name = "Key Vault Secrets User" },
        { key = "tfstate", scope = local.tfstate_container_scope, role_definition_name = "Storage Blob Data Reader" },
      ]
    }

    # test + preview ACA stacks. AcrPush, Managed Identity Operator on
    # id-bbm-aca-pull and LAW access are granted by stacks/global (those
    # resources do not exist yet at bootstrap time).
    "gh-bbm-ephemeral" = {
      environments = ["test", "preview"]
      role_assignments = [
        { key = "test-contributor", scope = local.rg_ids.test, role_definition_name = "Contributor" },
        { key = "preview-contributor", scope = local.rg_ids.preview, role_definition_name = "Contributor" },
        { key = "shared-reader", scope = local.rg_ids.shared, role_definition_name = "Reader" },
        local.state_writer,
      ]
    }

    "gh-bbm-global" = {
      environments = ["infra-global", "contracts-sepolia"]
      role_assignments = [
        { key = "shared-contributor", scope = local.rg_ids.shared, role_definition_name = "Contributor" },
        {
          key                  = "shared-rbac-admin"
          scope                = local.rg_ids.shared
          role_definition_name = "Role Based Access Control Administrator"
          condition            = local.rbac_condition.global
          condition_version    = "2.0"
        },
        # Create placeholder secrets in the shared KV (and read sepolia ones).
        { key = "shared-kv-secrets", scope = local.rg_ids.shared, role_definition_name = "Key Vault Secrets Officer" },
        # Budgets (subscription + RG) live in stacks/global.
        { key = "sub-cost-mgmt", scope = local.subscription_scope, role_definition_name = "Cost Management Contributor" },
        local.state_writer,
      ]
    }

    "gh-bbm-staging" = {
      environments     = ["staging"]
      role_assignments = local.env_identity_roles.staging
    }

    "gh-bbm-prod" = {
      environments     = ["prod", "prod-power"]
      role_assignments = local.env_identity_roles.prod
    }
  }
}

# ---- human access -----------------------------------------------------------
resource "azurerm_role_assignment" "admin_aks" {
  for_each = merge([
    for env in local.persistent_envs : {
      for oid in var.admin_object_ids : "${env}/${oid}" => { env = env, oid = oid }
    }
  ]...)

  scope                = azurerm_resource_group.env_compute[each.value.env].id
  role_definition_name = "Azure Kubernetes Service RBAC Cluster Admin"
  principal_id         = each.value.oid
}

resource "azurerm_role_assignment" "power_operator" {
  for_each = merge([
    for env in local.persistent_envs : merge([
      for layer in ["data", "compute"] : {
        for oid in var.power_operator_object_ids : "${env}-${layer}/${oid}" => {
          scope = layer == "data" ? azurerm_resource_group.env_data[env].id : azurerm_resource_group.env_compute[env].id
          oid   = oid
        }
      }
    ]...)
  ]...)

  scope              = each.value.scope
  role_definition_id = azurerm_role_definition.power_operator.role_definition_resource_id
  principal_id       = each.value.oid
}
