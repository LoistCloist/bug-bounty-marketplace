// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import GuidePage from "../page";

const CHAIN = {
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
  requiredStakeWei: "250000000000000000",
};

function renderGuide() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GuidePage />
    </QueryClientProvider>,
  );
}

describe("GuidePage", () => {
  it("on the local chain, describes the real stack and offers the real sample contract and exploit", async () => {
    server.use(http.get("*/api/chain", () => HttpResponse.json(CHAIN)));
    renderGuide();
    expect(await screen.findByText(/auditors stake 0\.25 ETH/)).toBeInTheDocument();
    expect(screen.getByText(/local Anvil chain/)).toBeInTheDocument();
    expect(screen.queryByText(/mock API/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sample contract/i })).toHaveAttribute(
      "href",
      "/examples/Vault.sol",
    );
    expect(screen.getByRole("link", { name: /sample PoC/i })).toHaveAttribute(
      "href",
      "/examples/VaultExploit.t.sol",
    );
  });

  it("in mock mode keeps the mock-environment copy and samples", async () => {
    renderGuide();
    expect(await screen.findByText(/mock API/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sample PoC/i })).toHaveAttribute(
      "href",
      "/examples/DemoExploit.t.sol",
    );
  });
});
