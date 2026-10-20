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

variable "secret_officer_object_ids" {
  description = "Entra object IDs granted Key Vault Secrets Officer on the shared vault (gh-bbm-global SP, plus the admins who set the Sepolia secrets with az keyvault secret set). Non-service-principal entries must be applied by an Owner locally: CI's constrained RBAC admin may only assign roles to service principals."
  type        = list(string)
  default     = []
}

variable "ephemeral_ci_principal_id" {
  description = "Object ID of the gh-bbm-ephemeral service principal (bootstrap output github_principal_ids). Gets AcrPush, Managed Identity Operator on id-bbm-aca-pull and Log Analytics Contributor on the shared LAW. Null skips these grants."
  type        = string
  default     = null
}

variable "acr_push_principal_ids" {
  description = "Additional Entra object IDs granted AcrPush on the registry (e.g. image build identities)."
  type        = list(string)
  default     = []
}
