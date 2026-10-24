// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { useRoleStore } from "@/lib/role/store";
import { MOCK_ADDRESSES } from "@/lib/addresses";
import { ANVIL_ACCOUNTS } from "@/lib/chain/accounts";
import { useWallet } from "..";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useWallet", () => {
  it("uses the mock addresses when no chain is configured", async () => {
    useRoleStore.setState({ role: "developer", connected: true });
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.address).toBe(MOCK_ADDRESSES.developer));
  });

  it("uses the role's anvil account on the local chain", async () => {
    server.use(
      http.get("*/api/chain", () =>
        HttpResponse.json({
          configured: true,
          chainId: 31337,
          rpcUrl: "http://localhost:8545",
          addresses: {
            auditorStaking: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
            bountyEscrow: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
            disputeResolution: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
          },
          arbiter: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          challengeWindowSeconds: 60,
          requiredStakeWei: "100000000000000000",
        }),
      ),
    );
    useRoleStore.setState({ role: "auditor", connected: true });
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.address).toBe(ANVIL_ACCOUNTS.auditor.address));
  });
});
