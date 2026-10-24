import { describe, expect, it, vi } from "vitest";
import { claimLockReleaser } from "./claim-lock-release.js";

describe("claimLockReleaser", () => {
  it("releases the claim lock once the bounty is paid or a dispute resolves", async () => {
    const applyDisputeResolved = vi.fn(async () => true);
    const release = claimLockReleaser({ applyDisputeResolved });

    await release("finding_paid", "Paid", "PayoutCredited");
    await release("finding_unfrozen", "Verified", "Unfrozen");
    await release("finding_verified", "Verified", "FindingVerified");
    await release("finding_frozen", "Disputed", "Frozen");

    expect(applyDisputeResolved.mock.calls).toEqual([["finding_paid"], ["finding_unfrozen"]]);
  });
});
