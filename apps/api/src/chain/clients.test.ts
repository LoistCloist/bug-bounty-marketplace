import { describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import type { AuditorStakingPort } from "./auditor-staking.js";
import { buildAuditorStakingPort } from "./clients.js";

const STAKING = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const KEY = `0x${"11".repeat(32)}`;

const CHAIN_ENV = {
  CHAIN_RPC_URL: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  OPERATOR_PRIVATE_KEY: KEY,
  AUDITOR_STAKING_ADDRESS: STAKING,
  BOUNTY_ESCROW_ADDRESS: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  DISPUTE_RESOLUTION_ADDRESS: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
} as const;

function fakePort(): AuditorStakingPort {
  return {
    stakeOf: vi.fn(),
    activeSubmissions: vi.fn(),
    lockSubmission: vi.fn(async () => `0x${"cd".repeat(32)}` as Hash),
    unlockSubmission: vi.fn(),
  };
}

describe("buildAuditorStakingPort", () => {
  it("returns no port when CHAIN_RPC_URL and CLAIM_LOCK_ENABLED are both unset", () => {
    const createPort = vi.fn(() => fakePort());
    expect(buildAuditorStakingPort({}, createPort)).toBeUndefined();
    expect(createPort).not.toHaveBeenCalled();
  });

  it("returns no port when the chain is configured but CLAIM_LOCK_ENABLED is unset", () => {
    const createPort = vi.fn(() => fakePort());
    expect(buildAuditorStakingPort({ ...CHAIN_ENV }, createPort)).toBeUndefined();
    expect(createPort).not.toHaveBeenCalled();
  });

  it.each(["false", "1", "TRUE", ""])("returns no port when CLAIM_LOCK_ENABLED=%j", (value) => {
    const createPort = vi.fn(() => fakePort());
    expect(
      buildAuditorStakingPort({ ...CHAIN_ENV, CLAIM_LOCK_ENABLED: value }, createPort),
    ).toBeUndefined();
    expect(createPort).not.toHaveBeenCalled();
  });

  it("returns no port when the lock is enabled but no chain is configured", () => {
    const createPort = vi.fn(() => fakePort());
    expect(buildAuditorStakingPort({ CLAIM_LOCK_ENABLED: "true" }, createPort)).toBeUndefined();
    expect(createPort).not.toHaveBeenCalled();
  });

  it("passes the parsed chain config to the factory and returns its port when the lock is enabled", () => {
    const port = fakePort();
    const createPort = vi.fn(() => port);
    const result = buildAuditorStakingPort({ ...CHAIN_ENV, CLAIM_LOCK_ENABLED: "true" }, createPort);
    expect(result).toBe(port);
    expect(createPort).toHaveBeenCalledTimes(1);
    expect(createPort).toHaveBeenCalledWith(
      expect.objectContaining({
        rpcUrl: CHAIN_ENV.CHAIN_RPC_URL,
        chainId: 31337,
        operatorPrivateKey: KEY,
        auditorStakingAddress: STAKING,
      }),
    );
  });

  it("still rejects a malformed chain config when the lock is disabled", () => {
    const createPort = vi.fn(() => fakePort());
    expect(() =>
      buildAuditorStakingPort({ CHAIN_RPC_URL: "http://127.0.0.1:8545" }, createPort),
    ).toThrow(/is missing/);
    expect(createPort).not.toHaveBeenCalled();
  });
});
