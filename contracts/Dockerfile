# syntax=docker/dockerfile:1.7
#
# Foundry toolchain image for contracts/. Build context: contracts/ (with the
# forge-std submodule checked out in lib/).
#
# Default: a local anvil node on :8545 (chain id 31337).
# One-shot deploy: override the entrypoint, e.g.
#   forge script script/Deploy.s.sol --rpc-url http://anvil:8545 \
#     --broadcast --private-key <key>
# which writes /contracts/deployments/<chainid>.json.
#
# Keep this tag in sync with the forge version used for .gas-snapshot.
FROM ghcr.io/foundry-rs/foundry:v1.3.5

# The base image runs as the non-root user `foundry` (uid/gid 1000, home
# /home/foundry). Create the workdir as root and hand it to that user so
# forge can write out/, cache/, broadcast/ and deployments/ at runtime.
USER root
RUN mkdir -p /contracts/deployments && chown -R foundry:foundry /contracts
USER foundry

WORKDIR /contracts
COPY --chown=foundry:foundry . .

# Compile now. This also downloads solc 0.8.19 into the foundry user's svm
# dir (/home/foundry/.local/share/svm, or ~/.svm if present), so build, test
# and deploy need no network at runtime as long as the container keeps
# running as `foundry`.
RUN forge build

EXPOSE 8545

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
    CMD ["cast", "block-number", "--rpc-url", "http://127.0.0.1:8545"]

ENTRYPOINT ["anvil"]
CMD ["--host", "0.0.0.0", "--chain-id", "31337"]
