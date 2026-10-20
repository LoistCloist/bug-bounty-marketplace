import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAuditorStakingPort, type AuditorStakingPort } from "./auditor-staking.js";
import type { ChainConfig } from "./config.js";

/** Builds the AuditorStaking port against the configured RPC node, signing
 * lock/unlock with the operator key. Only called when a chain is configured. */
export function createAuditorStakingFromConfig(config: ChainConfig): AuditorStakingPort {
  const transport = http(config.rpcUrl);
  const account = privateKeyToAccount(config.operatorPrivateKey);
  return createAuditorStakingPort({
    address: config.auditorStakingAddress as Address,
    publicClient: createPublicClient({ transport }),
    walletClient: createWalletClient({ account, transport }),
  });
}
