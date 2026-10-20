variable "subscription_id" {
  description = "Target Azure subscription GUID."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "eastus2"
}

variable "location_abbr" {
  description = "Short region code used in names."
  type        = string
  default     = "eus2"
}

variable "suffix" {
  description = "4-char suffix from the bootstrap output `suffix`."
  type        = string
}

variable "alert_emails" {
  description = "Emails that receive resource-group budget alerts."
  type        = list(string)
}

variable "rg_budget_amount" {
  description = "Monthly budget (USD) for each staging/prod data and compute resource group."
  type        = number
  default     = 20
}

variable "budget_start_date" {
  description = "Budget start (first of the month, RFC3339). Ignored after creation."
  type        = string
  default     = "2026-10-01T00:00:00Z"
}

variable "law_daily_quota_gb" {
  description = "Daily ingestion cap (GB) for the shared Log Analytics workspace."
  type        = number
  default     = 0.25
}

variable "secret_officer_sp_object_ids" {
  description = "Service principal object IDs granted Key Vault Secrets Officer on the shared vault (normally the gh-bbm-global SP). Assigned with principal_type ServicePrincipal, so CI (gh-bbm-global) can apply them."
  type        = list(string)
  default     = []
}

variable "secret_officer_user_object_ids" {
  description = "Entra user object IDs granted Key Vault Secrets Officer on the shared vault (the admins who set the Sepolia secrets with az keyvault secret set). Assigned with principal_type User, which CI's constrained RBAC admin cannot do: changes to this list must be applied locally by a subscription Owner."
  type        = list(string)
  default     = []
}

variable "ephemeral_ci_principal_id" {
  description = "Object ID of the gh-bbm-ephemeral service principal (bootstrap output github_principal_ids). Gets AcrPush, Managed Identity Operator on id-bbm-aca-pull and Log Analytics Contributor on the shared LAW. Null skips these grants."
  type        = string
  default     = null
}

variable "acr_push_principal_ids" {
  description = "Additional service principal / managed identity object IDs (image build identities) granted AcrPush on the registry. Assigned with principal_type ServicePrincipal; users and groups are not supported."
  type        = list(string)
  default     = []
}
