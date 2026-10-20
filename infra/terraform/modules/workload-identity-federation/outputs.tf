output "credentials" {
  description = "All federated credentials as \"<identity>/<name>\" => { id, subject, issuer }."
  value = {
    for k, c in merge(
      azurerm_federated_identity_credential.tier0,
      azurerm_federated_identity_credential.tier1,
      azurerm_federated_identity_credential.tier2,
    ) : k => { id = c.id, subject = c.subject, issuer = c.issuer }
  }
}

output "subjects" {
  description = "Sorted list of every federated subject."
  value       = sort([for e in local.entries : e.subject])
}
