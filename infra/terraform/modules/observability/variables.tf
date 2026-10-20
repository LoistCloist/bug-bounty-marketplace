variable "name" {
  description = "Log Analytics workspace name."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group to create the workspace in."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "daily_quota_gb" {
  description = "Daily ingestion cap in GB (cost guard). -1 means unlimited."
  type        = number
  default     = 0.25
}

variable "retention_in_days" {
  description = "Data retention in days (30 is the free-retention minimum for PerGB2018)."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Tags applied to the workspace."
  type        = map(string)
  default     = {}
}
