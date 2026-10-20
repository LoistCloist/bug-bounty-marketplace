#!/usr/bin/env bash
# Full on-chain lifecycle against `pnpm stack:demo`, from the command line:
#   1. payout: fund -> analysis -> stake -> claim -> passing PoC -> Verified ->
#      paid after the challenge window -> the auditor withdraws;
#   2. dispute: a second bounty -> Verified -> the developer disputes -> the
#      arbiter rules against the auditor -> Rejected, stake slashed by half.
# Users sign their own transactions with anvil's dev accounts (cast, inside the
# contracts image) and sign in to the API with a signed message. Prints
# LIFECYCLE OK. Needs curl and jq.
set -euo pipefail

API=${API:-http://localhost:3001}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
FIXTURES="$ROOT/workers/analysis/tests/fixtures"

# anvil dev accounts: local demo only.
ARB=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
ARB_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
DEV=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
DEV_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
AUD=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
AUD_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a

step() { printf '\n== %s\n' "$*"; }
die() { printf 'LIFECYCLE FAILED: %s\n' "$*" >&2; exit 1; }
for tool in curl jq docker; do command -v "$tool" >/dev/null || die "$tool is required"; done

# cast runs in the contracts image, on the compose network.
cast_rpc() { docker compose run --rm --no-deps -T --entrypoint cast anvil "$@" --rpc-url http://anvil:8545 2>/dev/null; }
cast_local() { docker compose run --rm --no-deps -T --entrypoint cast anvil "$@" 2>/dev/null; }

CHAIN=$(curl -sf "$API/api/chain") || die "API not reachable at $API"
[ "$(echo "$CHAIN" | jq -r .configured)" = "true" ] || die "the API has no chain: run pnpm stack:demo"
ESCROW=$(echo "$CHAIN" | jq -r .addresses.bountyEscrow)
STAKING=$(echo "$CHAIN" | jq -r .addresses.auditorStaking)
DISPUTES=$(echo "$CHAIN" | jq -r .addresses.disputeResolution)
WINDOW=$(echo "$CHAIN" | jq -r .challengeWindowSeconds)
JARS=$(mktemp -d)
trap 'rm -rf "$JARS"' EXIT

sign_in() { # key address jar
  local message signature
  message=$(curl -sf -H 'content-type: application/json' -d "{\"address\":\"$2\"}" "$API/api/auth/nonce" | jq -r .message)
  signature=$(cast_local wallet sign --private-key "$1" "$message")
  curl -sf -c "$3" -H 'content-type: application/json' \
    -d "{\"address\":\"$2\",\"signature\":\"$signature\"}" "$API/api/auth/login" >/dev/null || die "sign-in failed for $2"
}

finding_status() { curl -sf "$API/api/contracts/$1/findings" | jq -r ".[] | select(.id==\"$2\") | .status"; }

wait_status() { # contract finding status seconds
  for _ in $(seq 1 "$4"); do
    [ "$(finding_status "$1" "$2")" = "$3" ] && return 0
    sleep 1
  done
  die "finding $2 never reached $3 (now $(finding_status "$1" "$2"))"
}

# Developer: upload, fund on-chain, confirm. Echoes "contract finding".
funded_contract() {
  local contract onchain finding
  contract=$(curl -sf -b "$JARS/dev" -F "file=@$FIXTURES/Vault.sol" -F bountyAmount=1000000000000000000 \
    -F deadline=2030-01-01T00:00:00.000Z "$API/api/contracts" | jq -r .id)
  [ -n "$contract" ] && [ "$contract" != null ] || die "upload failed"
  onchain=$(cast_local keccak "$contract")
  cast_rpc send --private-key "$DEV_KEY" --value 1ether "$ESCROW" "fund(bytes32,uint256)" "$onchain" 1893456000 >/dev/null \
    || die "fund failed"
  curl -sf -b "$JARS/dev" -X POST "$API/api/contracts/$contract/funded" >/dev/null || die "funded check failed"
  for _ in $(seq 1 300); do
    finding=$(curl -sf "$API/api/contracts/$contract/findings" \
      | jq -r '[.[] | select(.slitherDetector=="reentrancy-eth")][0].id // empty')
    [ -n "$finding" ] && break
    sleep 1
  done
  [ -n "$finding" ] || die "no reentrancy finding for $contract"
  echo "$contract $finding"
}

# Auditor: claim and prove.
claim_and_prove() { # contract finding
  local status
  status=$(curl -sf -b "$JARS/aud" -H 'content-type: application/json' -d "{\"contractId\":\"$1\"}" \
    "$API/api/auditor/claim" | jq -r .status) || die "claim failed"
  [ "$status" = Claimed ] || die "claim returned $status"
  curl -sf -b "$JARS/aud" -F "findingId=$2" -F "file=@$FIXTURES/pocs/PoC_pass.t.sol" "$API/api/auditor/poc" >/dev/null \
    || die "PoC upload failed"
  wait_status "$1" "$2" Verified 180
}

step "Signing in as developer, auditor and arbiter"
sign_in "$DEV_KEY" "$DEV" "$JARS/dev"
sign_in "$AUD_KEY" "$AUD" "$JARS/aud"
sign_in "$ARB_KEY" "$ARB" "$JARS/arb"

step "Auditor stakes 0.1 ETH"
if [ "$(cast_rpc call "$STAKING" 'stakeOf(address)(uint256)' "$AUD" | awk '{print $1}')" = 0 ]; then
  cast_rpc send --private-key "$AUD_KEY" --value 0.1ether "$STAKING" "stake()" >/dev/null || die "stake failed"
fi
echo "profile: $(curl -sf -b "$JARS/aud" "$API/api/auditor/profile" | jq -c '{stake, reputation}')"

step "Payout: fund, prove, wait out the ${WINDOW}s challenge window"
read -r C1 F1 < <(funded_contract)
echo "contract $C1, reentrancy finding $F1"
claim_and_prove "$C1" "$F1"
echo "finding Verified"
wait_status "$C1" "$F1" Paid $((WINDOW + 60))
PENDING=$(curl -sf -b "$JARS/aud" "$API/api/auditor/profile" | jq -r .pendingPayout)
[ "$PENDING" = 1000000000000000000 ] || die "pending payout is $PENDING, expected 1 ETH"
cast_rpc send --private-key "$AUD_KEY" "$ESCROW" "withdrawPayout()" >/dev/null || die "withdraw failed"
echo "finding Paid, contract $(curl -sf "$API/api/contracts/$C1" | jq -r .status), 1 ETH withdrawn"

step "Dispute: a second bounty, disputed and ruled against the auditor"
read -r C2 F2 < <(funded_contract)
echo "contract $C2, reentrancy finding $F2"
claim_and_prove "$C2" "$F2"
cast_rpc send --private-key "$DEV_KEY" "$DISPUTES" "openDispute(bytes32,bytes32,string)" \
  "$(cast_local keccak "$C2")" "$(cast_local keccak "$F2")" "The PoC is not a realistic attack" >/dev/null || die "openDispute failed"
DISPUTE=$(curl -sf -b "$JARS/dev" -H 'content-type: application/json' -d '{"reason":"The PoC is not a realistic attack"}' \
  "$API/api/findings/$F2/dispute" | jq -r .id) || die "dispute route failed"
wait_status "$C2" "$F2" Disputed 30
STAKE_BEFORE=$(cast_rpc call "$STAKING" 'stakeOf(address)(uint256)' "$AUD" | awk '{print $1}')
cast_rpc send --private-key "$ARB_KEY" "$DISPUTES" "rule(bytes32,bytes32,bool)" \
  "$(cast_local keccak "$C2")" "$(cast_local keccak "$F2")" false >/dev/null || die "rule failed"
RULING=$(curl -sf -b "$JARS/arb" -H 'content-type: application/json' -d '{"ruling":"AgainstAuditor"}' \
  "$API/api/arbiter/disputes/$DISPUTE/rule" | jq -r .ruling) || die "ruling route failed"
wait_status "$C2" "$F2" Rejected 30
STAKE_AFTER=$(cast_rpc call "$STAKING" 'stakeOf(address)(uint256)' "$AUD" | awk '{print $1}')
[ "$STAKE_AFTER" = "$((STAKE_BEFORE / 2))" ] || die "stake $STAKE_BEFORE -> $STAKE_AFTER, expected half"
echo "ruling $RULING, finding Rejected, stake $STAKE_BEFORE -> $STAKE_AFTER wei"

printf '\nLIFECYCLE OK\n'
