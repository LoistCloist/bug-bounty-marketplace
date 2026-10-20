variable "subscription_id" {
  description = "Target Azure subscription GUID."
  type        = string
}

variable "env" {
  description = "Persistent environment: staging or prod."
  type        = string

  validation {
    condition     = contains(["staging", "prod"], var.env)
    error_message = "env must be staging or prod."
  }
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
  description = "4-char suffix from the bootstrap output `suffix` (same value as envs/global/global.tfvars)."
  type        = string
}

variable "vnet_cidr" {
  description = "VNet address space (staging 10.20.0.0/16, prod 10.30.0.0/16)."
  type        = string
}

variable "subnet_cidrs" {
  description = "Subnet CIDRs inside vnet_cidr: aks (/20 for nodes), psql (/24, delegated to PostgreSQL), pe (/24, private endpoints)."
  type = object({
    aks  = string
    psql = string
    pe   = string
  })
}

variable "postgres_sku_name" {
  description = "PostgreSQL Flexible Server SKU."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "postgres_storage_mb" {
  description = "PostgreSQL storage size in MB."
  type        = number
  default     = 32768
}

variable "postgres_backup_retention_days" {
  description = "PostgreSQL backup retention in days."
  type        = number
  default     = 7
}

variable "law_daily_quota_gb" {
  description = "Daily ingestion cap (GB) for the env Log Analytics workspace."
  type        = number
  default     = 0.5
}

variable "ingress_pip_zones" {
  description = "Availability zones for the ingress public IP (all three = zone-redundant, no extra cost). Empty list for regions without zones."
  type        = list(string)
  default     = ["1", "2", "3"]
}

variable "secret_officer_object_ids" {
  description = "Entra object IDs granted Key Vault Secrets Officer on the env vault: the human running a local apply (Terraform writes database-url/pg-admin-password) and whoever sets llm-api-key out of band. CI (gh-bbm-<env>) already has it via bootstrap."
  type        = list(string)
  default     = []
}
