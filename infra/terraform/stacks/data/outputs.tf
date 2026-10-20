# Consumed by stacks/compute (terraform_remote_state) and, through its
# helm_values output, by the Helm chart. Keep in sync with the infra spec.

output "resource_group_name" {
  description = "Data resource group name (rg-bbm-<env>-data-eus2)."
  value       = data.azurerm_resource_group.data.name
}

output "location" {
  description = "Azure region."
  value       = var.location
}

output "tenant_id" {
  description = "Entra tenant ID (azure.tenantId in Helm values)."
  value       = data.azurerm_client_config.current.tenant_id
}

output "key_vault_name" {
  description = "Env Key Vault name."
  value       = module.keyvault.name
}

output "key_vault_id" {
  description = "Env Key Vault resource ID."
  value       = module.keyvault.id
}

output "pg_fqdn" {
  description = "PostgreSQL server FQDN (private DNS)."
  value       = module.postgres.fqdn
}

output "pg_server_name" {
  description = "PostgreSQL server name (for az postgres flexible-server stop/start)."
  value       = module.postgres.name
}

output "storage_account_name" {
  description = "Env storage account name."
  value       = module.storage.name
}

output "storage_blob_endpoint" {
  description = "Blob service endpoint of the env storage account."
  value       = module.storage.primary_blob_endpoint
}

output "queue_name" {
  description = "Analysis job queue name."
  value       = module.storage.queue_name
}

output "ingress_pip_name" {
  description = "Static ingress public IP name."
  value       = azurerm_public_ip.ingress.name
}

output "ingress_ip" {
  description = "Static ingress public IP address."
  value       = azurerm_public_ip.ingress.ip_address
}

output "ingress_fqdn" {
  description = "Ingress DNS name (bbm-<env>.<region>.cloudapp.azure.com). Built from the PIP's DNS label, so it is known at plan time."
  value       = "${azurerm_public_ip.ingress.domain_name_label}.${var.location}.cloudapp.azure.com"
}

output "subnet_aks_id" {
  description = "Subnet ID for AKS nodes."
  value       = module.network.subnet_ids.aks
}

output "psql_subnet_cidr" {
  description = "PostgreSQL subnet CIDR (Helm networkPolicy.postgresCidr)."
  value       = module.network.subnet_cidrs.psql
}

output "law_id" {
  description = "Env Log Analytics workspace resource ID."
  value       = module.law.id
}

output "uami" {
  description = "Env managed identities keyed by role (aks, api, worker, sandbox): { id, client_id, principal_id }."
  value = {
    for k, v in module.identity.identities : k => {
      id           = v.id
      client_id    = v.client_id
      principal_id = v.principal_id
    }
  }
}
