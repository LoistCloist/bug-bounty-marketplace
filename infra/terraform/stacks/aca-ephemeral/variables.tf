variable "subscription_id" {
  description = "Target Azure subscription GUID."
  type        = string
}

variable "kind" {
  description = "Ephemeral environment kind: test (pipeline run) or preview (per PR). Selects rg-bbm-<kind>-eus2."
  type        = string

  validation {
    condition     = contains(["test", "preview"], var.kind)
    error_message = "kind must be \"test\" or \"preview\"."
  }
}

variable "env_name" {
  description = "Environment name: run-<run_id>-<attempt> (test) or pr-<n> (preview). Names cae-bbm-<env_name> and the <env_name>-{api,web,analysis} apps."
  type        = string

  validation {
    condition     = can(regex("^(run-[0-9]+-[0-9]+|pr-[0-9]+)$", var.env_name))
    error_message = "env_name must match run-<run_id>-<attempt> or pr-<n>."
  }

  # Container app names are capped at 32 chars; the longest is <env_name>-analysis.
  validation {
    condition     = length(var.env_name) <= 23
    error_message = "env_name must be at most 23 characters (container app names are capped at 32)."
  }
}

variable "image_tag" {
  description = "Image tag for bbm/api, bbm/analysis and (by default) bbm/web, e.g. sha-abc1234 or pr-42-sha-abc1234."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$", var.image_tag))
    error_message = "image_tag must be a valid OCI tag."
  }
}

variable "web_image_tag" {
  description = "Image tag for bbm/web; defaults to image_tag. Previews pass the mocked variant (<tag>-mocked)."
  type        = string
  default     = null
}

variable "acr_login_server" {
  description = "Registry login server; defaults to the global stack's acr_login_server output."
  type        = string
  default     = null
}

variable "analysis_enabled" {
  description = "Also deploy the analysis worker (internal ingress)."
  type        = bool
  default     = false
}

variable "postgres_image" {
  description = "Postgres sidecar image; defaults to <acr_login_server>/mirror/postgres:16-alpine."
  type        = string
  default     = null
}

variable "ttl_hours" {
  description = "Hours until the expires_on tag (janitor deletes after this); defaults to 6 for test, 168 for preview."
  type        = number
  default     = null

  validation {
    condition     = var.ttl_hours == null ? true : var.ttl_hours > 0
    error_message = "ttl_hours must be positive."
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

variable "tfstate_resource_group" {
  description = "Resource group of the tfstate storage account, used to read global.tfstate. tf.sh exports TF_VAR_tfstate_resource_group from $TFSTATE_RG."
  type        = string
  default     = "rg-bbm-tfstate-eus2"

  validation {
    condition     = length(trimspace(var.tfstate_resource_group)) > 0
    error_message = "tfstate_resource_group must not be empty: set TFSTATE_RG (tf.sh exports it as TF_VAR_tfstate_resource_group)."
  }
}

variable "tfstate_account" {
  description = "tfstate storage account name (stbbmtfstate<sfx>), used to read global.tfstate. tf.sh exports TF_VAR_tfstate_account from $TFSTATE_ACCOUNT."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{3,24}$", var.tfstate_account))
    error_message = "tfstate_account must be a storage account name (3-24 lowercase letters/digits): set TFSTATE_ACCOUNT (tf.sh exports it as TF_VAR_tfstate_account)."
  }
}
