import { useQueryClient } from "@tanstack/react-query";
import { signIn } from "@/lib/api/auth";
import { ANVIL_ACCOUNTS } from "@/lib/chain/accounts";
import { useRoleStore } from "@/lib/role/store";
import type { Wallet } from "./types";

/** Wallet backed by the role's anvil account. connect() signs in to the API
 * with it, so routes act for that address. */
export function useLocalWallet(): Wallet {
  const role = useRoleStore((s) => s.role);
  const connected = useRoleStore((s) => s.connected);
  const disconnect = useRoleStore((s) => s.disconnect);
  const queryClient = useQueryClient();

  return {
    address: connected ? ANVIL_ACCOUNTS[role].address : null,
    isConnected: connected,
    async connect() {
      await signIn(ANVIL_ACCOUNTS[role]);
      useRoleStore.setState({ connected: true });
      await queryClient.invalidateQueries();
    },
    disconnect,
  };
}
