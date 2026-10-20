# workers/sandbox

Docker image that auditors' Foundry PoCs run in (`bbm-sandbox:latest`). The
analysis worker (`workers/analysis`) starts one container per PoC, pipes the
contract and PoC in as a tar on stdin, and runs `forge test` with:

- no network (`--network none`)
- 1 GB memory, 1 CPU, at most 256 processes
- a read-only root filesystem plus a 256 MB tmpfs at `/tmp`
- a non-root user, every Linux capability dropped, `no-new-privileges`
- a hard time limit (`SANDBOX_TIMEOUT_SECONDS`, default 120), enforced inside
  the container with `timeout -s KILL` (so it holds even if the worker dies)
  and again by the worker, which kills the container if it overruns

Because PoCs run offline, everything forge needs is baked in:

| What | Where | Version |
| --- | --- | --- |
| Foundry | base image | `ghcr.io/foundry-rs/foundry:v1.5.1` (forge 1.5.1) |
| solc | `/opt/solc/solc-<version>` | every version in `../analysis/src/analysis/solc-versions.txt`, sha256-checked |
| forge-std | `/opt/forge-std` | `f3dae6e`, the commit `contracts/lib/forge-std` pins |

## Build and smoke test

```sh
docker build -f workers/sandbox/Dockerfile -t bbm-sandbox:latest workers

tar -C workers/sandbox/smoke -c . | docker run --rm -i --network none \
  --read-only --tmpfs /tmp:rw,exec,size=256m --user 1000:1000 bbm-sandbox:latest \
  sh -c 'mkdir -p /tmp/w && tar -x -C /tmp/w && cd /tmp/w && forge test -vvv'
# expect: Suite result: ok. 1 passed; 0 failed
```

## Writing a PoC

A PoC is a Foundry test file. In the sandbox the submitted contract sits at
`src/<filename>` and the PoC at `test/PoC.t.sol`, so import the target as:

```solidity
import "forge-std/Test.sol";
import "../src/Vault.sol";
```

The PoC passes, and the finding becomes Verified, when at least one test
passes and none fail.
