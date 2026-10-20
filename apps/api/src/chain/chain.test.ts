import { describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import { onchainId } from "./ids.js";
import { claimLockEnabled, loadChainConfig } from "./config.js";
import { createAuditorStakingPort } from "./auditor-staking.js";

const STAKING = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const AUDITOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hash;
const KEY = `0x${"11".repeat(32)}`;

const VALID_ENV = {
  CHAIN_RPC_URL: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  OPERATOR_PRIVATE_KEY: KEY,
  AUDITOR_STAKING_ADDRESS: STAKING,
  BOUNTY_ESCROW_ADDRESS: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  DISPUTE_RESOLUTION_ADDRESS: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
};

describe("onchainId", () => {
  it("is a deterministic 32-byte keccak256 of the API id", () => {
    const id = onchainId("contract_123");
    expect(id).toMatch(/^0x[a-f0-9]{64}$/);
    expect(onchainId("contract_123")).toBe(id);
    expect(onchainId("contract_456")).not.toBe(id);
  });
});

describe("loadChainConfig", () => {
  it("returns null when CHAIN_RPC_URL is unset", () => {
    expect(loadChainConfig({})).toBeNull();
  });

  it("parses a complete environment", () => {
    const config = loadChainConfig(VALID_ENV);
    expect(config).toMatchObject({ chainId: 31337, auditorStakingAddress: STAKING });
  });

  it("names every missing variable once CHAIN_RPC_URL is set", () => {
    expect(() => loadChainConfig({ CHAIN_RPC_URL: "http://x" })).toThrow(
      /CHAIN_ID, OPERATOR_PRIVATE_KEY, AUDITOR_STAKING_ADDRESS/,
    );
  });

  it("rejects a malformed address", () => {
    expect(() => loadChainConfig({ ...VALID_ENV, BOUNTY_ESCROW_ADDRESS: "0x123" })).toThrow(
      /BOUNTY_ESCROW_ADDRESS/,
    );
  });

  it("rejects a malformed private key", () => {
    expect(() => loadChainConfig({ ...VALID_ENV, OPERATOR_PRIVATE_KEY: "0x1234" })).toThrow(
      /OPERATOR_PRIVATE_KEY/,
    );
  });

  it("rejects a non-integer chain id", () => {
    expect(() => loadChainConfig({ ...VALID_ENV, CHAIN_ID: "sepolia" })).toThrow(/CHAIN_ID/);
  });
});

describe("createAuditorStakingPort", () => {
  function fakeClients(receiptStatus: "success" | "reverted" = "success") {
    const publicClient = {
      readContract: vi.fn(),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: receiptStatus }),
    };
    const walletClient = { writeContract: vi.fn().mockResolvedValue(HASH) };
    return { publicClient, walletClient };
  }

  it("reads stake and open submissions from the contract", async () => {
    const { publicClient, walletClient } = fakeClients();
    publicClient.readContract
      .mockResolvedValueOnce(100_000_000_000_000_000n)
      .mockResolvedValueOnce(2n);
    const port = createAuditorStakingPort({ address: STAKING, publicClient, walletClient });

    await expect(port.stakeOf(AUDITOR)).resolves.toBe(100_000_000_000_000_000n);
    await expect(port.activeSubmissions(AUDITOR)).resolves.toBe(2n);
    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: STAKING, functionName: "stakeOf", args: [AUDITOR] }),
    );
  });

  it("sends lockSubmission and waits for the receipt", async () => {
    const { publicClient, walletClient } = fakeClients();
    const port = createAuditorStakingPort({ address: STAKING, publicClient, walletClient });

    await expect(port.lockSubmission(AUDITOR)).resolves.toBe(HASH);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: STAKING, functionName: "lockSubmission", args: [AUDITOR] }),
    );
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: HASH });
  });

  it("sends unlockSubmission", async () => {
    const { publicClient, walletClient } = fakeClients();
    const port = createAuditorStakingPort({ address: STAKING, publicClient, walletClient });

    await port.unlockSubmission(AUDITOR);
    expect(walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "unlockSubmission", args: [AUDITOR] }),
    );
  });

  it("throws when the transaction reverts", async () => {
    const { publicClient, walletClient } = fakeClients("reverted");
    const port = createAuditorStakingPort({ address: STAKING, publicClient, walletClient });

    await expect(port.lockSubmission(AUDITOR)).rejects.toThrow(/lockSubmission reverted/);
  });
});

describe("claimLockEnabled", () => {
  it("is off unless CLAIM_LOCK_ENABLED is exactly true", () => {
    expect(claimLockEnabled({})).toBe(false);
    expect(claimLockEnabled({ CLAIM_LOCK_ENABLED: "false" })).toBe(false);
    expect(claimLockEnabled({ CLAIM_LOCK_ENABLED: "1" })).toBe(false);
    expect(claimLockEnabled({ CLAIM_LOCK_ENABLED: "true" })).toBe(true);
  });
});
