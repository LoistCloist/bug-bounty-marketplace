# Partial azurerm backend config for stacks/aca-ephemeral (kind = test).
# scripts/tf.sh adds key=$TF_STATE_KEY (must start with "test/"), and overrides
# resource_group_name / storage_account_name from $TFSTATE_RG / $TFSTATE_ACCOUNT.
resource_group_name  = "rg-bbm-tfstate-eus2"
storage_account_name = "stbbmtfstate0000" # replace with bootstrap output tfstate_storage_account
container_name       = "tfstate"
use_oidc             = true # CI: GitHub OIDC; locally falls through to `az login`
use_azuread_auth     = true # the account has shared keys disabled
