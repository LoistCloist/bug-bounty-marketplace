# id-bbm-aca-pull: attached to every ephemeral Container App to pull images.
resource "azurerm_user_assigned_identity" "aca_pull" {
  name                = module.naming.global.aca_pull_identity
  resource_group_name = data.azurerm_resource_group.shared.name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_role_assignment" "aca_pull_acr" {
  scope                            = module.acr.id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_user_assigned_identity.aca_pull.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

# Grants for the ephemeral CI identity on resources that only exist after this
# stack runs (bootstrap gives it Contributor on the test/preview RGs).
# gh-bbm-global may only assign these roles: see the ABAC condition in
# stacks/bootstrap/identities.tf.
locals {
  ephemeral_grants = var.ephemeral_ci_principal_id == null ? {} : {
    acr_push = { scope = module.acr.id, role = "AcrPush" }
    # Assign id-bbm-aca-pull to Container Apps.
    aca_pull_operator = { scope = azurerm_user_assigned_identity.aca_pull.id, role = "Managed Identity Operator" }
    # ACA environments read the workspace shared key to ship logs.
    law_contributor = { scope = module.law.id, role = "Log Analytics Contributor" }
  }
}

resource "azurerm_role_assignment" "ephemeral_ci" {
  for_each = local.ephemeral_grants

  scope                = each.value.scope
  role_definition_name = each.value.role
  principal_id         = var.ephemeral_ci_principal_id
  principal_type       = "ServicePrincipal"
}

# Build identities only (service principals / managed identities), so the
# assignment satisfies the ABAC PrincipalType condition on gh-bbm-global.
resource "azurerm_role_assignment" "acr_push" {
  for_each = toset(var.acr_push_principal_ids)

  scope                = module.acr.id
  role_definition_name = "AcrPush"
  principal_id         = each.key
  principal_type       = "ServicePrincipal"
}
