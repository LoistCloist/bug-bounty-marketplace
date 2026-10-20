variable "env_name" {
  description = "Ephemeral environment name (run-<id>-<attempt> or pr-<n>); prefixes every app name."
  type        = string
}

variable "environment_name" {
  description = "Container Apps managed environment name (cae-bbm-<env_name>)."
  type        = string
}

variable "resource_group_name" {
  description = "Existing resource group for the environment and apps."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "log_analytics_workspace_id" {
  description = "ARM ID of the Log Analytics workspace that receives container logs (the shared LAW)."
  type        = string
}

variable "acr_login_server" {
  description = "Container registry login server, e.g. acrbbmxxxx.azurecr.io."
  type        = string
}

variable "pull_identity_id" {
  description = "Resource ID of the user-assigned identity with AcrPull (id-bbm-aca-pull)."
  type        = string
}

variable "api_image" {
  description = "Full image reference for the api container."
  type        = string
}

variable "web_image" {
  description = "Full image reference for the web container."
  type        = string
}

variable "analysis_image" {
  description = "Full image reference for the analysis container (used only when analysis_enabled)."
  type        = string
}

variable "postgres_image" {
  description = "Full image reference for the Postgres sidecar in the api app."
  type        = string
}

variable "analysis_enabled" {
  description = "Deploy the analysis worker app (internal ingress)."
  type        = bool
  default     = false
}

variable "web_min_replicas" {
  description = "Minimum web replicas (0 lets previews scale to zero)."
  type        = number
  default     = 1

  validation {
    condition     = var.web_min_replicas >= 0 && var.web_min_replicas <= 2
    error_message = "web_min_replicas must be between 0 and 2 (web max_replicas is 2)."
  }
}

variable "tags" {
  description = "Tags applied to the environment and every app."
  type        = map(string)
  default     = {}
}
