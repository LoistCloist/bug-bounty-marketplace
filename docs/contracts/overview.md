# contracts/

Foundry project for the escrow/bounty smart contracts and the real security
contracts audited by the marketplace.

Currently contains only `Placeholder.sol` and a trivial Foundry test to prove
out the project structure. Real contracts (bounty escrow, dispute
arbitration, etc.) land in later branches.

For installing Foundry, fetching `forge-std`, and building and testing, see
[Foundry setup](foundry-setup.md).

The CI branch that wires up contract testing is responsible for running
`forge build` / `forge test` in a dedicated, path-filtered job.
