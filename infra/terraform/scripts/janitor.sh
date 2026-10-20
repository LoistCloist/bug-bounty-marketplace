#!/usr/bin/env bash
# Sweeps leftovers of ephemeral ACA environments (stacks/aca-ephemeral).
#
#   scripts/janitor.sh [--dry-run | --apply] [--state-max-age-hours N]
#
#   --dry-run                 list what would be deleted (default)
#   --apply                   actually delete
#   --state-max-age-hours N   tfstate blobs under test/ older than N hours are deleted (default 24)
#
# What it does (needs `az login`; CI uses the gh-bbm-ephemeral OIDC identity):
#   1. In rg-bbm-test-eus2 and rg-bbm-preview-eus2, finds container apps and
#      managed environments tagged ephemeral=true whose expires_on (RFC3339, UTC)
#      is in the past, and deletes the apps first, then the environments.
#   2. Deletes tfstate blobs under test/ in container `tfstate` of
#      $TFSTATE_ACCOUNT that are older than the max age (Entra auth only).
#      Preview state (preview/pr-<n>.tfstate) is left for preview.yml's
#      destroy-on-close job. Blob versioning/soft delete keep them recoverable.
#
# Any failed `az` listing (auth, throttling, ...) fails the run.
#
# It does not touch ACR: the image purge (acr purge --filter 'bbm/.*:pr-.*'
# --filter 'bbm/.*:sha-.*' --ago 30d --keep 10 --untagged) is its own job in
# .github/workflows/infra-janitor.yml, run as gh-bbm-global in the
# reviewer-gated infra-global environment. That job delete-locks the
# staging/prod bbm-last-deployed-tag tags first and fails closed.
#
# Env: TFSTATE_ACCOUNT (step 2 is skipped when unset).
set -euo pipefail

RESOURCE_GROUPS=(rg-bbm-test-eus2 rg-bbm-preview-eus2)
STATE_CONTAINER=tfstate
STATE_PREFIX=test/

dry_run=true
state_max_age_hours=24

die() {
  echo "janitor: $*" >&2
  exit 1
}

log() {
  echo "janitor: $*"
}

usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) dry_run=false ;;
    --dry-run) dry_run=true ;;
    --state-max-age-hours)
      [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]] || die "--state-max-age-hours needs a number"
      state_max_age_hours=$2
      shift
      ;;
    -h | --help) usage ;;
    *) die "unknown argument '$1' (see --help)" ;;
  esac
  shift
done

command -v az >/dev/null || die "az CLI not found"
az account show --only-show-errors >/dev/null 2>&1 || die "not logged in: run 'az login' (or azure/login in CI)"

# UTC timestamp N hours ago as YYYY-MM-DDTHH:MM:SS (GNU date, then BSD date).
utc_hours_ago() {
  date -u -d "$1 hours ago" +%Y-%m-%dT%H:%M:%S 2>/dev/null ||
    date -u -v-"$1"H +%Y-%m-%dT%H:%M:%S
}

# Timestamps are compared as strings on their first 19 chars
# (YYYY-MM-DDTHH:MM:SS), which orders correctly for UTC values. Terraform's
# timeadd() emits UTC ("...Z"); blob lastModified is "+00:00".
now=$(date -u +%Y-%m-%dT%H:%M:%S)
state_cutoff=$(utc_hours_ago "$state_max_age_hours")

mode="DRY RUN"
$dry_run || mode="APPLY"
log "mode: $mode, now: ${now}Z"

# Prints the IDs of expired ephemeral resources of one type in one RG.
# The listing is captured first so an az failure exits non-zero (a failure
# inside `< <(...)` would be ignored by set -e).
expired_ids() {
  local rg=$1 type=$2 id expires out
  out=$(az resource list --resource-group "$rg" --resource-type "$type" \
    --query "[?tags.ephemeral=='true'].[id, tags.expires_on]" -o tsv --only-show-errors) ||
    die "listing $type in $rg failed"
  while IFS=$'\t' read -r id expires; do
    [[ -n "$id" ]] || continue
    if [[ -z "$expires" || "$expires" == "None" ]]; then
      log "skip (no expires_on tag): $id" >&2
      continue
    fi
    if [[ "${expires:0:19}" < "$now" ]]; then
      echo "$id"
    fi
  done <<<"$out"
}

delete_ids() {
  local label=$1
  shift
  [[ $# -gt 0 ]] || return 0
  local id
  for id in "$@"; do
    log "$label: ${id##*/} ($id)"
  done
  if ! $dry_run; then
    az resource delete --ids "$@" --only-show-errors >/dev/null
  fi
}

# 1. Expired container apps, then their environments.
for rg in "${RESOURCE_GROUPS[@]}"; do
  exists=$(az group exists --name "$rg" --only-show-errors) || die "checking resource group $rg failed"
  if [[ "$exists" != "true" ]]; then
    log "resource group $rg not found, skipping"
    continue
  fi
  # Plain read loops instead of mapfile: bash 3.2 (macOS) has no mapfile.
  # expired_ids runs in a command substitution, so its die only exits the
  # subshell; `|| exit 1` propagates it.
  apps=()
  ids=$(expired_ids "$rg" Microsoft.App/containerApps) || exit 1
  while IFS= read -r id; do
    [[ -n "$id" ]] || continue
    apps+=("$id")
  done <<<"$ids"
  delete_ids "delete container app" ${apps[@]+"${apps[@]}"}
  envs=()
  ids=$(expired_ids "$rg" Microsoft.App/managedEnvironments) || exit 1
  while IFS= read -r id; do
    [[ -n "$id" ]] || continue
    envs+=("$id")
  done <<<"$ids"
  delete_ids "delete managed environment" ${envs[@]+"${envs[@]}"}
  [[ ${#apps[@]} -gt 0 || ${#envs[@]} -gt 0 ]] || log "$rg: nothing expired"
done

# 2. Stale test state blobs.
if [[ -z "${TFSTATE_ACCOUNT:-}" ]]; then
  log "TFSTATE_ACCOUNT not set, skipping tfstate cleanup"
else
  blobs=$(az storage blob list --auth-mode login --account-name "$TFSTATE_ACCOUNT" \
    --container-name "$STATE_CONTAINER" --prefix "$STATE_PREFIX" --num-results "*" \
    --query "[].[name, properties.lastModified]" -o tsv --only-show-errors) ||
    die "listing $STATE_CONTAINER/$STATE_PREFIX blobs in $TFSTATE_ACCOUNT failed"
  stale=0
  while IFS=$'\t' read -r name modified; do
    [[ -n "$name" ]] || continue
    if [[ "${modified:0:19}" < "$state_cutoff" ]]; then
      stale=$((stale + 1))
      log "delete state blob: $STATE_CONTAINER/$name (last modified $modified)"
      if ! $dry_run; then
        # A leased blob is a held state lock; leave it and report.
        az storage blob delete --auth-mode login --account-name "$TFSTATE_ACCOUNT" \
          --container-name "$STATE_CONTAINER" --name "$name" --only-show-errors >/dev/null ||
          log "WARN: could not delete $name (leased/locked?)"
      fi
    fi
  done <<<"$blobs"
  [[ $stale -gt 0 ]] || log "no $STATE_PREFIX state blobs older than ${state_max_age_hours}h"
fi

log "done ($mode)"
