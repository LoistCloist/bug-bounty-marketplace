import { useMemo } from "react";
import { ensureSignedIn } from "@/lib/api/auth";
import { useRoleStore } from "@/lib/role/store";
import { SEED_AUDITOR_ID } from "@/mocks/db";
import { ANVIL_ACCOUNTS } from "./accounts";
import { chainCalls, type ChainCalls } from "./calls";
import { isLocalChain, useChainInfo } from "./config";

/** The selected role's on-chain actions when the API runs on the local chain;
 * null in mock-only mode, where flows keep calling the mock API alone. Before
 * signing, each action makes sure the API session is this role's account, so
 * the API call that follows is made as the same account. */
export function useChainCalls(): ChainCalls | null {
  const info = useChainInfo();
  const role = useRoleStore((s) => s.role);
  return useMemo(() => {
    if (!isLocalChain(info)) return null;
    const account = ANVIL_ACCOUNTS[role];
    return chainCalls(info, account, undefined, { beforeSend: () => ensureSignedIn(account) });
  }, [info, role]);
}

/** The auditor id the API knows: the auditor's anvil address on the local
 * chain, the mock DB's seeded auditor otherwise. */
export function useAuditorId(): string {
  const info = useChainInfo();
  return isLocalChain(info) ? ANVIL_ACCOUNTS.auditor.address : SEED_AUDITOR_ID;
}

/** Required auditor stake in wei: the contract's on the local chain, the
 * mock demo's otherwise (passed in so callers keep their own default). */
export function useRequiredStakeWei(mockDefault: string): string {
  const info = useChainInfo();
  return isLocalChain(info) ? info.requiredStakeWei : mockDefault;
}
