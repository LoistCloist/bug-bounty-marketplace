#!/usr/bin/env bash
# Sweeps leftovers of ephemeral ACA environments (stacks/aca-ephemeral).
#
#   scripts/janitor.sh [--apply] [--acr-purge] [--state-max-age-hours N]
#
#   --dry-run                 list what would be deleted (default)
#   --apply                   actually delete
#   --acr-purge               also purge old pr-*/sha-* images from bbm/* (needs $ACR_NAME);
#                             in dry-run mode `acr purge --dry-run` only reports
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
#   3. With --acr-purge: `acr purge` of bbm/* tags pr-* and sha-* older than
#      30 days, keeping the 10 newest per repository, plus untagged manifests.
#
# Env: TFSTATE_ACCOUNT (step 2 is skipped when unset), ACR_NAME (--acr-purge).
set -euo pipefail

RESOURCE_GROUPS=(rg-bbm-test-eus2 rg-bbm-preview-eus2)
STATE_CONTAINER=tfstate
STATE_PREFIX=test/

dry_run=true
acr_purge=false
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
    --acr-purge) acr_purge=true ;;
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
expired_ids() {
  local rg=$1 type=$2 id expires
  while IFS=$'\t' read -r id expires; do
    [[ -n "$id" ]] || continue
    if [[ -z "$expires" || "$expires" == "None" ]]; then
      log "skip (no expires_on tag): $id" >&2
      continue
    fi
    if [[ "${expires:0:19}" < "$now" ]]; then
      echo "$id"
    fi
  done < <(az resource list --resource-group "$rg" --resource-type "$type" \
    --query "[?tags.ephemeral=='true'].[id, tags.expires_on]" -o tsv --only-show-errors)
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
  if [[ "$(az group exists --name "$rg" --only-show-errors)" != "true" ]]; then
    log "resource group $rg not found, skipping"
    continue
  fi
  # Plain read loops instead of mapfile: bash 3.2 (macOS) has no mapfile.
  apps=()
  while IFS= read -r id; do apps+=("$id"); done < <(expired_ids "$rg" Microsoft.App/containerApps)
  delete_ids "delete container app" ${apps[@]+"${apps[@]}"}
  envs=()
  while IFS= read -r id; do envs+=("$id"); done < <(expired_ids "$rg" Microsoft.App/managedEnvironments)
  delete_ids "delete managed environment" ${envs[@]+"${envs[@]}"}
  [[ ${#apps[@]} -gt 0 || ${#envs[@]} -gt 0 ]] || log "$rg: nothing expired"
done

# 2. Stale test state blobs.
if [[ -z "${TFSTATE_ACCOUNT:-}" ]]; then
  log "TFSTATE_ACCOUNT not set, skipping tfstate cleanup"
else
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
  done < <(az storage blob list --auth-mode login --account-name "$TFSTATE_ACCOUNT" \
    --container-name "$STATE_CONTAINER" --prefix "$STATE_PREFIX" --num-results "*" \
    --query "[].[name, properties.lastModified]" -o tsv --only-show-errors)
  [[ $stale -gt 0 ]] || log "no $STATE_PREFIX state blobs older than ${state_max_age_hours}h"
fi

# 3. Optional ACR purge (runs as an ACR task, so no local docker needed).
if $acr_purge; then
  [[ -n "${ACR_NAME:-}" ]] || die "--acr-purge needs ACR_NAME"
  purge_cmd="acr purge --filter 'bbm/.*:pr-.*' --filter 'bbm/.*:sha-.*' --ago 30d --keep 10 --untagged"
  $dry_run && purge_cmd+=" --dry-run"
  log "acr run on $ACR_NAME: $purge_cmd"
  az acr run --registry "$ACR_NAME" --cmd "$purge_cmd" /dev/null --only-show-errors
fi

log "done ($mode)"
