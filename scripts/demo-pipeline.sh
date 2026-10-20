#!/usr/bin/env bash
# End-to-end demo of the live analysis pipeline against the compose stack
# with the sandbox overlay (see README "Live analysis pipeline"):
#   submit Vault.sol -> Slither + LLM findings -> claim -> passing PoC
#   (Verified) -> failing PoC on another finding (Rejected).
# Needs curl and jq. API defaults to http://localhost:3001.
set -euo pipefail

API=${API:-http://localhost:3001}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
FIXTURES="$ROOT/workers/analysis/tests/fixtures"
AUDITOR=${AUDITOR:-auditor_1}
DEVELOPER=0x1234567890123456789012345678901234567890

step() { printf '\n== %s\n' "$*"; }
die() { printf 'DEMO FAILED: %s\n' "$*" >&2; exit 1; }

# wait_for <seconds> <command...>: retries the command once a second.
wait_for() {
  local limit=$1; shift
  for _ in $(seq 1 "$limit"); do
    if "$@"; then return 0; fi
    sleep 1
  done
  return 1
}

for tool in curl jq; do
  command -v "$tool" >/dev/null || die "$tool is required"
done
curl -sf "$API/health" >/dev/null || die "API not reachable at $API"

step "Submitting Vault.sol (a deliberately re-entrant vault)"
RESPONSE=$(curl -s -F "file=@$FIXTURES/Vault.sol" -F "developerAddress=$DEVELOPER" \
  -F bountyAmount=1 -F currency=ETH -F deadline=2030-01-01T00:00:00.000Z \
  "$API/api/contracts")
CONTRACT=$(echo "$RESPONSE" | jq -r '.id // empty' 2>/dev/null) || die "upload returned non-JSON: $RESPONSE"
[[ -n $CONTRACT ]] || die "upload rejected: $RESPONSE"
echo "contract: $CONTRACT"

step "Waiting for Slither + LLM analysis"
analysis_finished() {
  STATUS=$(curl -sf "$API/api/contracts/$CONTRACT/analysis" | jq -r .status) || return 1
  [[ $STATUS == Done || $STATUS == Failed ]]
}
wait_for 180 analysis_finished || die "analysis did not finish in 180s"
[[ $STATUS == Done ]] || die "analysis failed: $(curl -sf "$API/api/contracts/$CONTRACT/analysis" | jq -r .error)"
FINDINGS=$(curl -sf "$API/api/contracts/$CONTRACT/findings") || die "could not load findings"
echo "$FINDINGS" | jq -r '.[] | "\(.severity)\t\(.slitherDetector)\t\(.llmExplanation | gsub("\\s+"; " ") | .[0:100])"'

REENTRANCY=$(echo "$FINDINGS" | jq -r '[.[] | select(.slitherDetector == "reentrancy-eth")][0].id')
OTHER=$(echo "$FINDINGS" | jq -r '[.[] | select(.slitherDetector != "reentrancy-eth")][0].id // empty')
[[ $REENTRANCY != null ]] || die "expected a reentrancy-eth finding"

step "Claiming the contract as $AUDITOR"
CLAIM=$(curl -s -H 'content-type: application/json' \
  -d "{\"contractId\":\"$CONTRACT\",\"auditorId\":\"$AUDITOR\"}" "$API/api/auditor/claim")
[[ $(echo "$CLAIM" | jq -r '.status // empty') == Claimed ]] || die "claim rejected: $CLAIM"
echo "contract status: Claimed"

# finding_status <id>: prints the finding's current status.
finding_status() {
  curl -sf "$API/api/contracts/$CONTRACT/findings" | jq -r --arg id "$1" '.[] | select(.id == $id) | .status'
}

# submit_poc <finding id> <fixture> <expected status>
submit_poc() {
  local finding=$1 file=$2 expected=$3
  local response
  response=$(curl -s -F "findingId=$finding" -F "auditorId=$AUDITOR" \
    -F "file=@$FIXTURES/pocs/$file" "$API/api/auditor/poc")
  echo "$response" | jq -e .id >/dev/null || die "PoC rejected: $response"
  echo "$response" | jq -r '"PoC \(.id): \(.sandboxStatus)"'
  resolved() { local s; s=$(finding_status "$finding"); [[ $s == Verified || $s == Rejected ]]; }
  wait_for 180 resolved || die "sandbox did not finish in 180s (is the stack running with docker-compose.sandbox.yml and bbm-sandbox:latest built?)"
  local got; got=$(finding_status "$finding")
  echo "finding $finding: $got"
  [[ $got == "$expected" ]] || die "expected $expected, got $got"
}

step "Submitting a real exploit PoC against the reentrancy finding"
submit_poc "$REENTRANCY" PoC_pass.t.sol Verified

if [[ -n $OTHER ]]; then
  step "Submitting a PoC that doesn't reproduce against another finding"
  submit_poc "$OTHER" PoC_fail.t.sol Rejected
fi

printf '\nDEMO OK\n'
