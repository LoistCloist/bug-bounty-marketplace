# stacks/aca-ephemeral, pipeline test runs (integration-azure.yml).
# Per-run values come from the workflow as TF_VAR_* env vars:
#   TF_VAR_subscription_id, TF_VAR_env_name=run-<run_id>-<attempt>, TF_VAR_image_tag=sha-<7>,
#   plus TFSTATE_RG / TFSTATE_ACCOUNT (repo vars), which tf.sh exports as
#   TF_VAR_tfstate_resource_group / TF_VAR_tfstate_account.
kind             = "test"
location         = "eastus2"
location_abbr    = "eus2"
analysis_enabled = false
ttl_hours        = 6
