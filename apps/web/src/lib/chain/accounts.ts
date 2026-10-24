import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Role } from "@/lib/role/store";

/**
 * anvil's well-known dev accounts, one per demo role. They only ever exist on
 * a local chain (chain id 31337): the web app uses them only when GET
 * /api/chain says it is talking to one. Never use these keys elsewhere.
 */
export const ANVIL_ACCOUNTS: Record<Role, PrivateKeyAccount> = {
  // #0: the deployer, which the deploy script makes the arbiter.
  arbiter: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"),
  developer: privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"),
  auditor: privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"),
};

export const LOCAL_CHAIN_ID = 31337;
