import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { createDisputeResolutionPort } from "./dispute-resolution.js";

const DISPUTES = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address;
const DEVELOPER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const AUDITOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const CONTRACT_KEY = `0x${"c1".repeat(32)}` as Hex;
const FINDING_KEY = `0x${"f1".repeat(32)}` as Hex;
const DISPUTE_KEY = `0x${"d1".repeat(32)}` as Hex;

describe("createDisputeResolutionPort", () => {
  it("looks up the dispute key on-chain and returns the dispute", async () => {
    const publicClient = {
      readContract: vi
        .fn()
        .mockResolvedValueOnce(DISPUTE_KEY)
        .mockResolvedValueOnce([DEVELOPER, AUDITOR, 1_900_000_000n, false]),
    };
    const port = createDisputeResolutionPort({ address: DISPUTES, publicClient });

    await expect(port.getDispute(CONTRACT_KEY, FINDING_KEY)).resolves.toEqual({
      developer: DEVELOPER,
      auditor: AUDITOR,
      ruleBy: 1_900_000_000n,
      resolved: false,
    });
    expect(publicClient.readContract).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ functionName: "disputeKey", args: [CONTRACT_KEY, FINDING_KEY] }),
    );
    expect(publicClient.readContract).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ functionName: "disputes", args: [DISPUTE_KEY] }),
    );
  });

  it("returns null when no dispute exists for the finding", async () => {
    const publicClient = {
      readContract: vi
        .fn()
        .mockResolvedValueOnce(DISPUTE_KEY)
        .mockResolvedValueOnce([ZERO, ZERO, 0n, false]),
    };
    const port = createDisputeResolutionPort({ address: DISPUTES, publicClient });

    await expect(port.getDispute(CONTRACT_KEY, FINDING_KEY)).resolves.toBeNull();
  });

  it("reports a resolved dispute", async () => {
    const publicClient = {
      readContract: vi
        .fn()
        .mockResolvedValueOnce(DISPUTE_KEY)
        .mockResolvedValueOnce([DEVELOPER, AUDITOR, 1_900_000_000n, true]),
    };
    const port = createDisputeResolutionPort({ address: DISPUTES, publicClient });

    await expect(port.getDispute(CONTRACT_KEY, FINDING_KEY)).resolves.toMatchObject({
      resolved: true,
    });
  });
});
