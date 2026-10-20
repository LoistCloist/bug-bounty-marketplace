output "suffix" {
  description = "The suffix the names were built with."
  value       = var.suffix
}

output "location" {
  description = "Azure region (full name)."
  value       = var.location
}

output "global" {
  description = "Names of global/shared resources (tfstate, shared RG, ACR, shared LAW/KV, ACA pull identity, test/preview RGs)."
  value       = local.global
}

output "env" {
  description = "Names of per-environment resources for var.env (data/compute RGs, VNet, PG, KV, storage, LAW, PIP, AKS)."
  value       = local.env
}

output "uamis" {
  description = "Per-environment user-assigned managed identity names keyed by role (aks, api, worker, sandbox)."
  value       = local.uamis
}

output "env_short" {
  description = "Short environment code used in length-limited names (stg, prd, ...)."
  value       = local.env_short
}

output "aca_environment" {
  description = "Container Apps environment name (cae-bbm-<env_name>), or null when ephemeral_env_name is unset."
  value       = var.ephemeral_env_name == null ? null : "cae-${local.p}-${var.ephemeral_env_name}"
}

output "tags" {
  description = "Standard tags for var.layer."
  value       = local.tags_by_layer[var.layer]
}

output "tags_by_layer" {
  description = "Standard tags for every layer (global, data, compute, ephemeral), for stacks that span layers."
  value       = local.tags_by_layer
}
