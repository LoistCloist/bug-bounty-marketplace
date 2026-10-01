import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Role = "developer" | "auditor" | "arbiter";

export const ROLES: Role[] = ["developer", "auditor", "arbiter"];

interface RoleState {
  role: Role;
  connected: boolean;
  setRole: (role: Role) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
}

/** Which active role the UI is acting as, plus mock wallet connection
 * state. Persisted to localStorage so a reload keeps your place. */
export const useRoleStore = create<RoleState>()(
  persist(
    (set) => ({
      role: "developer",
      connected: true,
      setRole: (role) => set({ role }),
      connect: async () => {
        // tiny delay so UI can show a "connecting..." affordance, mirroring
        // what a real wallet connect() would feel like.
        await new Promise((resolve) => setTimeout(resolve, 150));
        set({ connected: true });
      },
      disconnect: () => set({ connected: false }),
    }),
    { name: "bbm-role" },
  ),
);
