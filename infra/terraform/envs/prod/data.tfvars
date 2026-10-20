# stacks/data for prod — persistent data layer (VNet, PG, KV, storage, UAMIs, PIP, LAW).
subscription_id = "00000000-0000-0000-0000-000000000000"
env             = "prod"
location        = "eastus2"
location_abbr   = "eus2"
suffix          = "0000" # bootstrap output: suffix (same as envs/global/global.tfvars)

vnet_cidr = "10.30.0.0/16"
subnet_cidrs = {
  aks  = "10.30.0.0/20"  # AKS nodes
  psql = "10.30.16.0/24" # delegated to PostgreSQL Flexible Server (Helm networkPolicy.postgresCidr)
  pe   = "10.30.17.0/24" # private endpoints (reserved)
}

postgres_sku_name              = "B_Standard_B1ms"
postgres_storage_mb            = 32768
postgres_backup_retention_days = 7

law_daily_quota_gb = 0.5
ingress_pip_zones  = ["1", "2", "3"]

# Object IDs granted Key Vault Secrets Officer on the env KV: whoever applies
# locally, and whoever sets llm-api-key out of band
# (az keyvault secret set --vault-name <kv> --name llm-api-key --value ...).
# gh-bbm-prod already has Secrets Officer on the data RG via bootstrap.
secret_officer_object_ids = []
