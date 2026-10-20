# Per-env user-assigned managed identities and their RBAC grants. They live
# in the persistent data RG so their client IDs survive compute down/up; the
# compute stack adds the workload-identity federated credentials.

resource "azurerm_user_assigned_identity" "this" {
  for_each = var.identities

  name                = each.value
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = var.tags
}

resource "azurerm_role_assignment" "this" {
  for_each = var.role_assignments

  scope                = each.value.scope
  role_definition_name = each.value.role
  principal_id         = azurerm_user_assigned_identity.this[each.value.identity].principal_id
  principal_type       = "ServicePrincipal"
  # Fresh identities may not have replicated in Entra yet.
  skip_service_principal_aad_check = true
}
