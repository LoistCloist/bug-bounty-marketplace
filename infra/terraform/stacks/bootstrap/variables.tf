variable "subscription_id" {
  description = "Target Azure subscription GUID."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", var.subscription_id))
    error_message = "subscription_id must be a lowercase GUID."
  }
}

variable "location" {
  description = "Azure region for all long-lived resource groups."
  type        = string
  default     = "eastus2"
}

variable "location_abbr" {
  description = "Short region code used in names."
  type        = string
  default     = "eus2"
}

variable "github_repo" {
  description = "GitHub repository (owner/name) trusted by the OIDC identities."
  type        = string
  default     = "LoistCloist/bug-bounty-marketplace"
}

variable "admin_object_ids" {
  description = "Entra object IDs (e.g. the bbm-admins group) granted AKS RBAC Cluster Admin on the compute RGs and state access."
  type        = list(string)
  default     = []
}

variable "power_operator_object_ids" {
  description = "Entra object IDs granted the custom 'BBM Power Operator' role on staging/prod RGs (pause/resume without Contributor)."
  type        = list(string)
  default     = []
}

variable "alert_emails" {
  description = "Emails that receive subscription budget alerts."
  type        = list(string)
}

variable "subscription_budget_amount" {
  description = "Monthly subscription budget in USD."
  type        = number
  default     = 50
}

variable "budget_start_date" {
  description = "Budget start (first of the month, RFC3339). Ignored after creation."
  type        = string
  default     = "2026-10-01T00:00:00Z"
}

variable "github_reviewer_ids" {
  description = "GitHub user IDs (numeric) added as required reviewers on infra-global, prod and contracts-sepolia in gh_setup_commands. Empty = add reviewers manually."
  type        = list(number)
  default     = []
}

variable "preregistered_resource_providers" {
  description = "Resource provider namespaces that are ALREADY registered on the subscription; they are imported instead of created (avoids 'already registered' errors)."
  type        = list(string)
  default     = []
}
