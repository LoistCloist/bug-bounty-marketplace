// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { QueueList } from "./QueueList";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const ITEM = {
  id: "contract_q1",
  developerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  filename: "Vault.sol",
  sourceHash: "a".repeat(64),
  sourceReference: "contracts/contract_q1/a.sol",
  bountyId: "bounty_q1",
  status: "Open",
  createdAt: "2026-10-24T10:00:00.000Z",
  deadline: "2030-01-01T00:00:00.000Z",
  bounty: { amount: "1000000000000000000", currency: "ETH" },
};

/** Renders the queue with one item and the claim answering 409 with `error`. */
async function claimRefusedWith(error: string) {
  server.use(
    http.get("*/api/auditor/queue", () => HttpResponse.json([ITEM])),
    http.post("*/api/auditor/claim", () => HttpResponse.json({ error }, { status: 409 })),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <QueueList auditorId="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Claim" }));
}

describe("QueueList claim errors", () => {
  it("tells an auditor who already holds a claim to finish it first", async () => {
    await claimRefusedWith("auditor already holds an active claim");
    expect(
      await screen.findByText(/You already hold a claim on another contract/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Someone else already claimed/)).not.toBeInTheDocument();
  });

  it("says when the bounty is not funded on-chain yet", async () => {
    await claimRefusedWith("bounty not funded on-chain");
    expect(await screen.findByText(/isn’t funded on-chain yet/)).toBeInTheDocument();
  });

  it("still reports a contract someone else claimed", async () => {
    await claimRefusedWith("Contract contract_q1 is not open to claim");
    expect(
      await screen.findByText(/Someone else already claimed that contract/),
    ).toBeInTheDocument();
  });
});
