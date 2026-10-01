import { MOCK_ADDRESSES } from "../addresses";
import { useRoleStore } from "../role/store";
import type { Wallet } from "./types";

/**
 * Mock wallet hook. Each role gets a distinct fixed fake address (matching
 * the seed data's `developerAddress`/`AuditorProfile.address`), and
 * connect/disconnect are backed by the role store so the header's wallet
 * badge and role switcher stay in sync.
 *
 * Swapping this out for wagmi later means replacing this file's export with
 * a hook that returns the same `Wallet` shape - no call sites change.
 */
export function useWallet(): Wallet {
  const role = useRoleStore((s) => s.role);
  const connected = useRoleStore((s) => s.connected);
  const connect = useRoleStore((s) => s.connect);
  const disconnect = useRoleStore((s) => s.disconnect);

  return {
    address: connected ? MOCK_ADDRESSES[role] : null,
    isConnected: connected,
    connect,
    disconnect,
  };
}
