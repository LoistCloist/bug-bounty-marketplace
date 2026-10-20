import { describe, expect, it, vi } from "vitest";
import type { Address, Hash, Hex } from "viem";
import { createBountyEscrowPort } from "./bounty-escrow.js";

const ESCROW = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const AUDITOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const CONTRACT_KEY = `0x${"c1".repeat(32)}` as Hex;
const FINDING_KEY = `0x${"f1".repeat(32)}` as Hex;
const HASH = `0x${"ab".repeat(32)}` as Hash;

function fakeClients(receiptStatus: "success" | "reverted" = "success") {
  const publicClient = {
    readContract: vi.fn(),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: receiptStatus }),
  };
  const walletClient = { writeContract: vi.fn().mockResolvedValue(HASH) };
  return { publicClient, walletClient };
}

describe("createBountyEscrowPort", () => {
  it("records a submission and waits for the receipt", async () => {
    const { publicClient, walletClient } = fakeClients();
    const port = createBountyEscrowPort({ address: ESCROW, publicClient, walletClient });

    await expect(port.recordSubmission(CONTRACT_KEY)).resolves.toBe(HASH);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: ESCROW,
        functionName: "recordSubmission",
        args: [CONTRACT_KEY],
      }),
    );
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: HASH });
  });

  it("records a verification with the finding and auditor", async () => {
    const { publicClient, walletClient } = fakeClients();
    const port = createBountyEscrowPort({ address: ESCROW, publicClient, walletClient });

    await port.recordVerification(CONTRACT_KEY, FINDING_KEY, AUDITOR);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "recordVerification",
        args: [CONTRACT_KEY, FINDING_KEY, AUDITOR],
      }),
    );
  });

  it("sends a payout with the finding and auditor", async () => {
    const { publicClient, walletClient } = fakeClients();
    const port = createBountyEscrowPort({ address: ESCROW, publicClient, walletClient });

    await port.payout(CONTRACT_KEY, FINDING_KEY, AUDITOR);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "payout", args: [CONTRACT_KEY, FINDING_KEY, AUDITOR] }),
    );
  });

  it("reads an auditor's pending payout", async () => {
    const { publicClient, walletClient } = fakeClients();
    publicClient.readContract.mockResolvedValueOnce(5_000_000_000_000_000n);
    const port = createBountyEscrowPort({ address: ESCROW, publicClient, walletClient });

    await expect(port.pendingPayouts(AUDITOR)).resolves.toBe(5_000_000_000_000_000n);
    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: ESCROW, functionName: "pendingPayouts", args: [AUDITOR] }),
    );
  });

  it("throws when a payout reverts", async () => {
    const { publicClient, walletClient } = fakeClients("reverted");
    const port = createBountyEscrowPort({ address: ESCROW, publicClient, walletClient });

    await expect(port.payout(CONTRACT_KEY, FINDING_KEY, AUDITOR)).rejects.toThrow(
      /BountyEscrow\.payout reverted/,
    );
  });
});
