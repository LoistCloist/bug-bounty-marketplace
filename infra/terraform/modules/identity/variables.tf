variable "identities" {
  description = "User-assigned managed identities to create, role => name (e.g. api => id-bbm-staging-api)."
  type        = map(string)
}

variable "resource_group_name" {
  description = "Resource group for the identities."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "role_assignments" {
  description = "RBAC grants keyed by a stable name. identity must be a key of var.identities. Every role must be in env_delegable_roles (stacks/bootstrap/identities.tf) or the env CI identity cannot assign it."
  type = map(object({
    identity = string
    scope    = string
    role     = string
  }))
  default = {}

  validation {
    condition     = alltrue([for ra in values(var.role_assignments) : contains(keys(var.identities), ra.identity)])
    error_message = "Every role_assignments[*].identity must be a key of var.identities."
  }
}

variable "tags" {
  description = "Tags applied to the identities."
  type        = map(string)
  default     = {}
}
