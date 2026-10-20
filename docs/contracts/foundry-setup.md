# Foundry setup

Setup for building and testing the Solidity contracts in `contracts/`. See
[overview](overview.md) for the project layout.

## Install Foundry (once per machine)

Foundry is installed on your machine, not in the repo, so each contributor
installs it once. The toolchain is `forge`, `cast`, and `anvil`.

On macOS or Linux, run:

```sh
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

On Windows, Foundry's installer runs in Git Bash (or WSL). Open Git Bash and
run the same two commands. Afterwards, open a new shell and check the install:

```sh
forge --version
```

## Set up the project

Clone the repo, then fetch the `forge-std` test library into `contracts/lib/`:

```sh
git submodule update --init --recursive
```

If `contracts/lib/forge-std` is missing after that (for example, the submodule
is not committed yet), install it manually:

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
