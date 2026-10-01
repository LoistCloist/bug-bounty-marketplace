// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetMockDb, cancelAllScheduled } from "@/mocks/db";
import { developerApi } from "@/lib/api";
import { FindingCard } from "../FindingCard";

const DEVELOPER_ADDRESS = `0x${"d1".repeat(20)}`;

beforeEach(() => {
  resetMockDb();
});

afterEach(() => {
  cancelAllScheduled();
});

function renderCard(finding: Awaited<ReturnType<typeof developerApi.listFindings>>[number]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FindingCard finding={finding} developerAddress={DEVELOPER_ADDRESS} />
    </QueryClientProvider>,
  );
}

describe("FindingCard", () => {
  it("shows severity, explanation, and toggles the raw Slither output", () => {
    const flagged = {
      id: "finding_test",
      contractId: "contract_test",
      severity: "Critical" as const,
      slitherDetector: "reentrancy-eth",
      rawOutputReference: "mock://slither/contract_test/reentrancy-eth.json",
      llmExplanation: "A reentrancy bug lets an attacker drain funds.",
      status: "Flagged" as const,
      statusHistory: [{ status: "Flagged" as const, changedAt: new Date().toISOString() }],
      claimedByAuditorId: null,
      claimExpiresAt: null,
      isFalsePositive: false,
      challengeWindowExpiresAt: null,
    };

    renderCard(flagged);

    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText(/reentrancy bug lets an attacker drain funds/i)).toBeInTheDocument();

    expect(screen.queryByText(flagged.rawOutputReference)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show raw slither output/i }));
    expect(screen.getByText(flagged.rawOutputReference)).toBeInTheDocument();

    // No dispute affordance on a Flagged finding.
    expect(screen.queryByRole("button", { name: /dispute this finding/i })).not.toBeInTheDocument();
  });

  it("lets the developer dispute a Verified finding within its challenge window", async () => {
    const findings = await developerApi.listFindings("contract_3");
    const verified = findings.find((f) => f.status === "Verified");
    expect(verified).toBeDefined();

    renderCard(verified!);

    fireEvent.click(screen.getByRole("button", { name: /dispute this finding/i }));
    fireEvent.change(screen.getByPlaceholderText(/why do you think/i), {
      target: { value: "The PoC doesn't hold against the real token implementation." },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit dispute/i }));

    await waitFor(async () => {
      const after = await developerApi.listFindings("contract_3");
      expect(after.find((f) => f.id === verified!.id)?.status).toBe("Disputed");
    });
  });
});
