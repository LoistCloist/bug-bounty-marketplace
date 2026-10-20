variable "issuer_url" {
  description = "OIDC issuer URL of the AKS cluster (changes when the cluster is recreated)."
  type        = string
}

variable "audience" {
  description = "Token audience accepted by Entra ID."
  type        = string
  default     = "api://AzureADTokenExchange"
}

variable "identities" {
  description = <<-EOT
    Federated credentials per user-assigned identity, keyed by a short role name
    (api, worker, ...). `credentials` maps a credential name (3-120 chars,
    alphanumeric/-/_) to a subject such as `system:serviceaccount:<ns>:<sa>`.
    At most 3 credentials per identity (see main.tf for why).
  EOT
  type = map(object({
    user_assigned_identity_id = string
    credentials               = map(string)
  }))

  validation {
    condition = alltrue([
      for k, v in var.identities : length(v.credentials) >= 1 && length(v.credentials) <= 3
    ])
    error_message = "Each identity needs 1 to 3 federated credentials."
  }

  validation {
    condition = alltrue(flatten([
      for k, v in var.identities : [
        for name in keys(v.credentials) : can(regex("^[A-Za-z0-9][A-Za-z0-9_-]{2,119}$", name))
      ]
    ]))
    error_message = "Credential names must be 3-120 chars: alphanumeric, '-' or '_', starting alphanumeric."
  }
}
