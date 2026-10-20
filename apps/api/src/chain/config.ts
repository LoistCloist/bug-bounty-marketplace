import type { Address, Hex } from "viem";

export interface ChainConfig {
  rpcUrl: string;
  chainId: number;
  operatorPrivateKey: Hex;
  auditorStakingAddress: Address;
  bountyEscrowAddress: Address;
  disputeResolutionAddress: Address;
}

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const PRIVATE_KEY = /^0x[a-fA-F0-9]{64}$/;

/**
 * Reads chain settings from the environment. Returns null when CHAIN_RPC_URL
 * is unset, so the API runs without a chain, the same way it runs without
 * DATABASE_URL. Once CHAIN_RPC_URL is set, every other variable is required.
 */
export function loadChainConfig(env: NodeJS.ProcessEnv): ChainConfig | null {
  const rpcUrl = env.CHAIN_RPC_URL;
  if (!rpcUrl) return null;

  const required = [
    "CHAIN_ID",
    "OPERATOR_PRIVATE_KEY",
    "AUDITOR_STAKING_ADDRESS",
    "BOUNTY_ESCROW_ADDRESS",
    "DISPUTE_RESOLUTION_ADDRESS",
  ] as const;
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`CHAIN_RPC_URL is set but ${missing.join(", ")} is missing`);
  }

  const chainId = Number(env.CHAIN_ID);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error("CHAIN_ID must be a positive integer");
  }

  const operatorPrivateKey = env.OPERATOR_PRIVATE_KEY!;
  if (!PRIVATE_KEY.test(operatorPrivateKey)) {
    throw new Error("OPERATOR_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  }

  const addresses = [
    "AUDITOR_STAKING_ADDRESS",
    "BOUNTY_ESCROW_ADDRESS",
    "DISPUTE_RESOLUTION_ADDRESS",
  ] as const;
  for (const name of addresses) {
    if (!ADDRESS.test(env[name]!)) {
      throw new Error(`${name} must be a 0x-prefixed 20-byte address`);
    }
  }

  return {
    rpcUrl,
    chainId,
    operatorPrivateKey: operatorPrivateKey as Hex,
    auditorStakingAddress: env.AUDITOR_STAKING_ADDRESS as Address,
    bountyEscrowAddress: env.BOUNTY_ESCROW_ADDRESS as Address,
    disputeResolutionAddress: env.DISPUTE_RESOLUTION_ADDRESS as Address,
  };
}

/**
 * True only when CLAIM_LOCK_ENABLED is exactly "true". The on-chain lock on
 * claim stays off by default: a lock with no unlock (plan item 6) can strand
 * an auditor's stake.
 */
export function claimLockEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.CLAIM_LOCK_ENABLED === "true";
}
