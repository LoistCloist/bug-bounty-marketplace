variable "name" {
  description = "Storage account name (stbbm<stg|prd><sfx>, 3-24 lowercase alphanumerics)."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group for the account."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "container_name" {
  description = "Private blob container for uploaded contract sources."
  type        = string
  default     = "sources"
}

variable "queue_name" {
  description = "Queue the API enqueues analysis jobs on (KEDA scales the worker from its length)."
  type        = string
  default     = "analysis-jobs"
}

variable "soft_delete_days" {
  description = "Blob and container soft-delete retention in days."
  type        = number
  default     = 7
}

variable "tags" {
  description = "Tags applied to the account."
  type        = map(string)
  default     = {}
}
