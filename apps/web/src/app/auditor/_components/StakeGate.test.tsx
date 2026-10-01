// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StakeGate, REQUIRED_STAKE } from "./StakeGate";

function withQueryClient(children: ReactNode) {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("StakeGate", () => {
  it("locks PoC upload below the required stake and shows the shortfall", () => {
    render(
      withQueryClient(
        <StakeGate
          profile={{ id: "auditor_1", address: "0xabc", stake: 5_000, reputation: 12, claimedContractIds: [] }}
          auditorId="auditor_1"
          onStaked={vi.fn()}
        />,
      ),
    );

    expect(screen.getByText("PoC upload locked")).toBeInTheDocument();
    expect(screen.getByText(`5,000 / ${REQUIRED_STAKE.toLocaleString()} required`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /post stake/i })).toBeInTheDocument();
  });

  it("shows the unlocked state and hides the stake form once stake meets the requirement", () => {
    render(
      withQueryClient(
        <StakeGate
          profile={{
            id: "auditor_1",
            address: "0xabc",
            stake: REQUIRED_STAKE,
            reputation: 12,
            claimedContractIds: [],
          }}
          auditorId="auditor_1"
          onStaked={vi.fn()}
        />,
      ),
    );

    expect(screen.getByText("PoC upload unlocked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /post stake/i })).not.toBeInTheDocument();
  });

  it("calls onStaked after successfully posting stake via the mocked API", async () => {
    const onStaked = vi.fn();

    render(
      withQueryClient(
        <StakeGate
          profile={{ id: "auditor_1", address: "0xabc", stake: 5_000, reputation: 12, claimedContractIds: [] }}
          auditorId="auditor_1"
          onStaked={onStaked}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /post stake/i }));

    await waitFor(() => expect(onStaked).toHaveBeenCalledTimes(1));
  });
});
