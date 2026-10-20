output "client_ids" {
  description = "Application (client) ID per identity — the AZURE_CLIENT_ID for azure/login."
  value       = { for k, v in azuread_application_registration.this : k => v.client_id }
}

output "principal_ids" {
  description = "Service principal object ID per identity (for role assignments in other stacks)."
  value       = { for k, v in azuread_service_principal.this : k => v.object_id }
}

output "application_object_ids" {
  description = "App registration object ID per identity."
  value       = { for k, v in azuread_application_registration.this : k => v.object_id }
}

output "subjects" {
  description = "Federated credential subjects per identity."
  value = {
    for name in keys(var.identities) :
    name => [for k, c in local.credentials : c.subject if c.identity == name]
  }
}
