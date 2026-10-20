import type { FastifyInstance } from "fastify";
import type { ChainInfo } from "@bbm/shared";
import type { ChainConfig } from "./config.js";
import { REQUIRED_STAKE_WEI } from "../pipeline/routes.js";

export interface ChainRouteDeps {
  /** Null when no chain is configured (CHAIN_RPC_URL unset). */
  config: ChainConfig | null;
}

/** The browser-facing description of the chain: what the web app needs to
 * sign transactions itself. Never includes the operator key. */
export function chainInfo(config: ChainConfig | null): ChainInfo {
  if (config === null) return { configured: false };
  return {
    configured: true,
    chainId: config.chainId,
    rpcUrl: config.publicRpcUrl,
    addresses: {
      auditorStaking: config.auditorStakingAddress,
      bountyEscrow: config.bountyEscrowAddress,
      disputeResolution: config.disputeResolutionAddress,
    },
    arbiter: config.arbiterAddress,
    challengeWindowSeconds: config.challengeWindowSeconds,
    requiredStakeWei: REQUIRED_STAKE_WEI,
  };
}

export function registerChainRoutes(app: FastifyInstance, deps: ChainRouteDeps): void {
  const info = chainInfo(deps.config);
  app.get("/api/chain", async () => info);
}
