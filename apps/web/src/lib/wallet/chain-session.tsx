"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { signIn } from "@/lib/api/auth";
import { ANVIL_ACCOUNTS } from "@/lib/chain/accounts";
import { isLocalChain, useChainInfo } from "@/lib/chain/config";
import { useRoleStore } from "@/lib/role/store";

/**
 * On the local chain, keeps the API session in step with the selected role:
 * signs in with the role's anvil account on load and on every role switch,
 * then refetches so pages show that account's data. Renders nothing.
 */
export function ChainSession() {
  const info = useChainInfo();
  const role = useRoleStore((s) => s.role);
  const queryClient = useQueryClient();
  const local = isLocalChain(info);

  useEffect(() => {
    if (!local) return;
    let cancelled = false;
    void signIn(ANVIL_ACCOUNTS[role])
      .then(() => {
        if (!cancelled) return queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "chain" });
      })
      .catch((err: unknown) => console.error("sign-in failed", err));
    return () => {
      cancelled = true;
    };
  }, [local, role, queryClient]);

  return null;
}
