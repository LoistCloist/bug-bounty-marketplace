# stacks/aca-ephemeral, per-PR previews (preview.yml).
# Per-PR values come from the workflow as TF_VAR_* env vars:
#   TF_VAR_subscription_id, TF_VAR_env_name=pr-<n>, TF_VAR_image_tag=pr-<n>-sha-<7>,
#   TF_VAR_web_image_tag=pr-<n>-sha-<7>-mocked,
#   TF_VAR_tfstate_resource_group / TF_VAR_tfstate_account (repo vars TFSTATE_RG / TFSTATE_ACCOUNT).
kind             = "preview"
location         = "eastus2"
location_abbr    = "eus2"
analysis_enabled = false
ttl_hours        = 168
