# Foundry setup

Setup for building and testing the Solidity contracts in `contracts/`. See
[overview](overview.md) for the contracts, roles and deploy flow.

## Install Foundry (once per machine)

Foundry is installed on your machine, not in the repo, so each contributor
installs it once. The toolchain is `forge`, `cast`, and `anvil`.

The committed `.gas-snapshot` and the Docker image are pinned to Foundry
**v1.3.5**, so install that version:

```sh
curl -L https://foundry.paradigm.xyz | bash
foundryup --install v1.3.5
```

On Windows, Foundry's installer runs in Git Bash (or WSL). Open Git Bash and
run the same two commands. Afterwards, open a new shell and check the install:

```sh
forge --version
```

## Set up the project

Clone the repo, then fetch the `forge-std` test library into `contracts/lib/`
(it is a git submodule):

```sh
git submodule update --init --recursive
```

Or clone with `git clone --recurse-submodules`. If `contracts/lib/forge-std`
is still missing, install it manually:

```sh
cd contracts
forge install foundry-rs/forge-std --no-commit
```

## Build and test

```sh
cd contracts
forge build
forge test
```

## Gas snapshot

`contracts/.gas-snapshot` records the gas used by every test. CI runs
`forge snapshot --check` and fails if it differs. The fuzz seed is pinned in
`foundry.toml` (`[fuzz] seed = "0x1"`) so fuzz tests give the same numbers
every run.

After changing contracts or tests, regenerate it with the pinned forge
version and commit the result:

```sh
cd contracts
forge snapshot          # rewrite .gas-snapshot
forge snapshot --check  # what CI runs
```

A different forge version can change gas numbers, so use v1.3.5.

## Deploy script

`script/Deploy.s.sol` deploys and wires `AuditorStaking`, `BountyEscrow` and
`DisputeResolution`. The environment variables and output are described in
the [overview](overview.md#deploy-script).

```sh
cd contracts

# Dry run in an in-memory EVM. Nothing is sent and no files are written.
forge script script/Deploy.s.sol

# Deploy to a local anvil (start `anvil` first) with anvil's account #0.
forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Or pass the key, roles and timings through the environment.
DEPLOYER_PRIVATE_KEY=0x... ARBITER=0x... CHALLENGE_WINDOW=86400 \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

A broadcast writes `deployments/<chainid>.json` (git-ignored) and forge's
own transaction log under `broadcast/` (also git-ignored). `foundry.toml`
grants the script read-write access to `./deployments` only.
