import { isLocalChain, useChainInfo } from "@/lib/chain/config";
import { useWallet as useMockWallet } from "./mock";
import { useLocalWallet } from "./local";
import type { Wallet } from "./types";

export type { Wallet } from "./types";

/** The role's anvil account when the API runs on the local chain; the mock
 * wallet otherwise (mock-only demo). */
export function useWallet(): Wallet {
  const info = useChainInfo();
  const mock = useMockWallet();
  const local = useLocalWallet();
  return isLocalChain(info) ? local : mock;
}
