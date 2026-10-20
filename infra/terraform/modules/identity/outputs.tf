output "identities" {
  description = "Created identities keyed by role: { id, client_id, principal_id, name }."
  value = {
    for k, id in azurerm_user_assigned_identity.this : k => {
      id           = id.id
      client_id    = id.client_id
      principal_id = id.principal_id
      name         = id.name
    }
  }
}

output "role_assignment_ids" {
  description = "Role assignment IDs keyed like var.role_assignments."
  value       = { for k, ra in azurerm_role_assignment.this : k => ra.id }
}
