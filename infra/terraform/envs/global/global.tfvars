# stacks/global — fill from `./scripts/tf.sh bootstrap global output global_tfvars_hint`.
subscription_id = "00000000-0000-0000-0000-000000000000"
location        = "eastus2"
location_abbr   = "eus2"
suffix          = "0000" # bootstrap output: suffix

alert_emails       = ["bbm-admins@example.com"]
rg_budget_amount   = 20
budget_start_date  = "2026-10-01T00:00:00Z"
law_daily_quota_gb = 0.25

# Object IDs (not client IDs) from bootstrap output github_principal_ids.
ephemeral_ci_principal_id = null # gh-bbm-ephemeral
secret_officer_object_ids = []   # gh-bbm-global SP + your admin user/group (needed to az keyvault secret set)
acr_push_principal_ids    = []
