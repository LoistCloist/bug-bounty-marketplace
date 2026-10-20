# Federated identity credentials that let Kubernetes service accounts on one
# cluster exchange their tokens for user-assigned identity tokens.
#
# Azure rejects concurrent federated-credential writes on the SAME identity
# ("Concurrent Federated Identity Credentials writes under the same managed
# identity are not supported"). Credentials are therefore split into ordered
# tiers: tier N of every identity is created in parallel across identities,
# but only after tier N-1 finished (depends_on). Three tiers cover the
# max-3-per-identity validation.

locals {
  # Deterministic order inside each identity: sorted credential names.
  entries = flatten([
    for id_key, id in var.identities : [
      for idx, cred_name in sort(keys(id.credentials)) : {
        key                       = "${id_key}/${cred_name}"
        tier                      = idx
        name                      = cred_name
        subject                   = id.credentials[cred_name]
        user_assigned_identity_id = id.user_assigned_identity_id
      }
    ]
  ])

  tier = {
    for t in [0, 1, 2] : t => { for e in local.entries : e.key => e if e.tier == t }
  }
}

resource "azurerm_federated_identity_credential" "tier0" {
  for_each = local.tier[0]

  name                      = each.value.name
  user_assigned_identity_id = each.value.user_assigned_identity_id
  issuer                    = var.issuer_url
  subject                   = each.value.subject
  audience                  = [var.audience]
}

resource "azurerm_federated_identity_credential" "tier1" {
  for_each = local.tier[1]

  name                      = each.value.name
  user_assigned_identity_id = each.value.user_assigned_identity_id
  issuer                    = var.issuer_url
  subject                   = each.value.subject
  audience                  = [var.audience]

  depends_on = [azurerm_federated_identity_credential.tier0]
}

resource "azurerm_federated_identity_credential" "tier2" {
  for_each = local.tier[2]

  name                      = each.value.name
  user_assigned_identity_id = each.value.user_assigned_identity_id
  issuer                    = var.issuer_url
  subject                   = each.value.subject
  audience                  = [var.audience]

  depends_on = [azurerm_federated_identity_credential.tier1]
}
