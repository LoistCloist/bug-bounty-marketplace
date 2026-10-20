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
# aca-ephemeral REQUIRES $TF_STATE_KEY matching <env>/run-<run_id>-<attempt>.tfstate
# or <env>/pr-<n>.tfstate (validate excepted: it never touches the backend);
# it is ignored for every other stack so a stray export cannot cross-wire state.
# $TFSTATE_RG / $TFSTATE_ACCOUNT override the backend file's resource group /
# storage account, and are exported as TF_VAR_tfstate_resource_group /
# TF_VAR_tfstate_account (unless already set) for terraform_remote_state.
# Other TF_VAR_* env vars pass through to terraform untouched.
#
# `apply <planfile>` applies a saved plan without -var-file (terraform rejects
# both together). `init -migrate-state` / `-reconfigure` run interactively so
# terraform can ask before copying state (or pass -force-copy yourself).
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

if [[ "$stack" == "aca-ephemeral" && "$cmd" == "validate" ]]; then
  state_key="" # validate runs init -backend=false: no state key needed
elif [[ "$stack" == "aca-ephemeral" ]]; then
  [[ -n "${TF_STATE_KEY:-}" ]] ||
    die "aca-ephemeral needs TF_STATE_KEY (e.g. test/run-<run_id>-<attempt>.tfstate or preview/pr-<n>.tfstate)"
  key_re="^${env}/(run-[0-9]+-[0-9]+|pr-[0-9]+)\.tfstate$"
  [[ "$TF_STATE_KEY" =~ $key_re ]] ||
    die "TF_STATE_KEY '$TF_STATE_KEY' must match $env/run-<run_id>-<attempt>.tfstate or $env/pr-<n>.tfstate"
  state_key=$TF_STATE_KEY
elif [[ "$env" == "global" ]]; then
  state_key="$stack.tfstate"
else
  state_key="$env/$stack.tfstate"
fi

# Backend coordinates for terraform_remote_state data sources in the stacks.
if [[ -n "${TFSTATE_RG:-}" && -z "${TF_VAR_tfstate_resource_group:-}" ]]; then
  export TF_VAR_tfstate_resource_group="$TFSTATE_RG"
fi
if [[ -n "${TFSTATE_ACCOUNT:-}" && -z "${TF_VAR_tfstate_account:-}" ]]; then
  export TF_VAR_tfstate_account="$TFSTATE_ACCOUNT"
fi

tf() {
  terraform -chdir="$stack_dir" "$@"
}

# True if any remaining arg is one of the given flags.
has_flag() {
  local a f
  for a in "${extra_args[@]+"${extra_args[@]}"}"; do
    for f in "$@"; do
      [[ "$a" == "$f" ]] && return 0
    done
  done
  return 1
}

# `apply <planfile>`: the first extra arg is an existing file, relative to the
# stack dir (terraform -chdir) or absolute.
is_planfile_apply() {
  [[ "$cmd" == "apply" && $# -ge 1 && "$1" != -* ]] || return 1
  [[ -f "$1" && "$1" == /* ]] || [[ -f "$stack_dir/$1" ]]
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
if [[ "$cmd" != "validate" ]] && uses_remote_backend; then
  [[ -f "$backend_file" ]] || die "missing backend config $backend_file"
  backend_args+=("-backend-config=$backend_file" "-backend-config=key=$state_key")
  if [[ -n "${TFSTATE_RG:-}" ]]; then
    backend_args+=("-backend-config=resource_group_name=$TFSTATE_RG")
  fi
  if [[ -n "${TFSTATE_ACCOUNT:-}" ]]; then
    backend_args+=("-backend-config=storage_account_name=$TFSTATE_ACCOUNT")
  fi
fi

extra_args=("$@")

case "$cmd" in
  init)
    # -migrate-state / -reconfigure may need to ask before copying state;
    # -input=false would make that prompt fail.
    input_args=(-input=false)
    if has_flag -migrate-state -reconfigure; then
      input_args=()
    fi
    # ${arr[@]+...} keeps `set -u` happy on bash 3.2 (macOS) with empty arrays.
    tf init ${input_args[@]+"${input_args[@]}"} ${backend_args[@]+"${backend_args[@]}"} "$@"
    ;;
  validate)
    tf init -backend=false -input=false
    tf validate "$@"
    ;;
  apply)
    if is_planfile_apply "$@"; then
      # A saved plan already carries its variables; -var-file is an error here.
      tf apply -input=false "$@"
    else
      require_var_file
      tf apply -input=false -var-file="$var_file" "$@"
    fi
    ;;
  plan | destroy | import)
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
