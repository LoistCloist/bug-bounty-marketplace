# contracts/

Foundry project for the escrow/bounty smart contracts and the real security
contracts audited by the marketplace. `forge` is not installed in this
scaffolding environment, so this directory was hand-written to match the
layout `forge init` would produce, rather than generated.

Currently contains only `Placeholder.sol` and a trivial Foundry test to prove
out the project structure. Real contracts (bounty escrow, dispute
arbitration, etc.) land in later branches.

## Before `forge build` / `forge test` will work

`lib/forge-std` is not vendored in this branch. Install it first:

```sh
forge install foundry-rs/forge-std --no-commit
```

The CI branch that wires up contract testing is responsible for installing
`forge-std` (or vendoring it) and running `forge build` / `forge test` in a
dedicated, path-filtered job.
