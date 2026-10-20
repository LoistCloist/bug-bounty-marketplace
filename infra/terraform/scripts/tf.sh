#!/usr/bin/env bash
# Terraform wrapper: picks the stack dir, var-file and backend config for an env.
#
#   scripts/tf.sh <stack> <env> <command> [extra terraform args]
#
#   stack    bootstrap | global | data | compute | aca-ephemeral
#   env      global (bootstrap, global) | staging, prod (data, compute) | test, preview (aca-ephemeral)
#   command  init | plan | apply | destroy | output | validate | import | console | <any terraform subcommand>
#
# Files used (relative to infra/terraform):
#   stacks/<stack>/                                  working dir (terraform -chdir)
#   envs/<env>/<stack>.tfvars  (aca-ephemeral: envs/<env>/aca.tfvars)
#   envs/<env>/backend-<stack>.hcl, else envs/<env>/backend.hcl
#
# State key: <stack>.tfstate for env=global, <env>/<stack>.tfstate otherwise.
# aca-ephemeral REQUIRES $TF_STATE_KEY (e.g. test/run-123-1.tfstate, preview/pr-42.tfstate);
# it is ignored for every other stack so a stray export cannot cross-wire state.
# $TFSTATE_RG / $TFSTATE_ACCOUNT override the backend file's resource group /
# storage account. TF_VAR_* env vars pass through to terraform untouched.
#
# Note: relative paths in extra args (e.g. -out=tfplan) resolve inside stacks/<stack>.
set -euo pipefail

die() {
  echo "tf.sh: $*" >&2
  exit 1
}

usage() {
  # Print the header comment block (line 2 up to the first non-comment line).
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}" >&2
  exit 2
}

[[ $# -ge 3 ]] || usage

stack=$1
env=$2
cmd=$3
shift 3

tf_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$stack" in
  bootstrap | global) allowed_envs="global" ;;
  data | compute) allowed_envs="staging prod" ;;
  aca-ephemeral) allowed_envs="test preview" ;;
  *) die "unknown stack '$stack' (bootstrap|global|data|compute|aca-ephemeral)" ;;
esac
[[ " $allowed_envs " == *" $env "* ]] || die "stack '$stack' does not support env '$env' (allowed: $allowed_envs)"

stack_dir="$tf_root/stacks/$stack"
env_dir="$tf_root/envs/$env"
[[ -d "$stack_dir" ]] || die "missing stack directory $stack_dir"
[[ -d "$env_dir" ]] || die "missing env directory $env_dir"

if [[ "$stack" == "aca-ephemeral" ]]; then
  var_file="$env_dir/aca.tfvars"
else
  var_file="$env_dir/$stack.tfvars"
fi

if [[ -f "$env_dir/backend-$stack.hcl" ]]; then
  backend_file="$env_dir/backend-$stack.hcl"
else
  backend_file="$env_dir/backend.hcl"
fi

if [[ "$stack" == "aca-ephemeral" ]]; then
  [[ -n "${TF_STATE_KEY:-}" ]] ||
    die "aca-ephemeral needs TF_STATE_KEY (e.g. test/run-<run_id>-<attempt>.tfstate or preview/pr-<n>.tfstate)"
  [[ "$TF_STATE_KEY" == "$env/"* ]] || die "TF_STATE_KEY must start with '$env/' for env '$env'"
  state_key=$TF_STATE_KEY
elif [[ "$env" == "global" ]]; then
  state_key="$stack.tfstate"
else
  state_key="$env/$stack.tfstate"
fi

tf() {
  terraform -chdir="$stack_dir" "$@"
}

require_var_file() {
  [[ -f "$var_file" ]] || die "missing var-file $var_file"
}

# bootstrap starts on the local backend until its backend block is uncommented;
# only pass -backend-config when the stack actually declares an azurerm backend.
uses_remote_backend() {
  grep -Eq '^[[:space:]]*backend[[:space:]]+"azurerm"' "$stack_dir"/*.tf
}

backend_args=()
if uses_remote_backend; then
  [[ -f "$backend_file" ]] || die "missing backend config $backend_file"
  backend_args+=("-backend-config=$backend_file" "-backend-config=key=$state_key")
  if [[ -n "${TFSTATE_RG:-}" ]]; then
    backend_args+=("-backend-config=resource_group_name=$TFSTATE_RG")
  fi
  if [[ -n "${TFSTATE_ACCOUNT:-}" ]]; then
    backend_args+=("-backend-config=storage_account_name=$TFSTATE_ACCOUNT")
  fi
fi

case "$cmd" in
  init)
    # ${arr[@]+...} keeps `set -u` happy on bash 3.2 (macOS) with empty arrays.
    tf init -input=false ${backend_args[@]+"${backend_args[@]}"} "$@"
    ;;
  validate)
    tf init -backend=false -input=false
    tf validate "$@"
    ;;
  plan | apply | destroy | import)
    require_var_file
    tf "$cmd" -input=false -var-file="$var_file" "$@"
    ;;
  console)
    require_var_file
    tf console -var-file="$var_file" "$@"
    ;;
  *)
    # output, show, state, providers, test, fmt, ... — passed through as-is.
    tf "$cmd" "$@"
    ;;
esac
