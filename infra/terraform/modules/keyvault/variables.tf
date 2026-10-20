variable "name" {
  description = "Key Vault name (kv-bbm-<stg|prd>-<sfx>, max 24 chars)."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group for the vault."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "tenant_id" {
  description = "Entra tenant ID the vault trusts."
  type        = string
}

variable "secret_officer_sp_object_ids" {
  description = "Service principal object IDs granted Key Vault Secrets Officer on this vault. Assigned with principal_type ServicePrincipal, so CI (gh-bbm-<env>) can apply them. The env CI identity itself already has the role on the data RG from bootstrap."
  type        = list(string)
  default     = []
}

variable "secret_officer_user_object_ids" {
  description = "Entra user object IDs granted Key Vault Secrets Officer on this vault (the human running a local apply, whoever sets llm-api-key). Assigned with principal_type User, which CI's constrained RBAC admin cannot do: changes to this list must be applied locally by a subscription Owner first."
  type        = list(string)
  default     = []
}

variable "secrets" {
  description = "Terraform-generated secrets (name => value). Values are stored in Terraform state; never pass externally supplied secrets here."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "rbac_propagation_wait" {
  description = "How long to wait after granting Secrets Officer before writing secrets (RBAC propagation)."
  type        = string
  default     = "60s"
}

variable "tags" {
  description = "Tags applied to the vault."
  type        = map(string)
  default     = {}
}
