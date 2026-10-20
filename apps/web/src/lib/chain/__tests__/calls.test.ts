import { describe, expect, it, vi } from "vitest";
import { keccak256, toBytes, type Hash } from "viem";
import type { ChainInfo } from "@bbm/shared";
import { ChainTxError, chainCalls, type ContractWrite, type TxClient } from "../calls";
import { ANVIL_ACCOUNTS } from "../accounts";
import { onchainId } from "../ids";

const INFO: Extract<ChainInfo, { configured: true }> = {
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
};
const HASH = `0x${"ab".repeat(32)}` as Hash;

function fakeClient(overrides: Partial<TxClient> = {}): TxClient & { writes: ContractWrite[] } {
  const writes: ContractWrite[] = [];
  return {
    writes,
    simulate: vi.fn(async () => undefined),
    write: vi.fn(async (req: ContractWrite) => {
      writes.push(req);
      return HASH;
    }),
    waitForSuccess: vi.fn(async () => true),
    ...overrides,
  };
}

describe("onchainId", () => {
  it("is keccak256 of the API id, like the API's", () => {
    expect(onchainId("contract_1")).toBe(keccak256(toBytes("contract_1")));
  });
});

describe("chainCalls", () => {
  it("funds a bounty with the deadline in unix seconds and the amount as value", async () => {
    const client = fakeClient();
    const calls = chainCalls(INFO, ANVIL_ACCOUNTS.developer, client);

    await expect(calls.fundBounty("contract_1", new Date("2030-01-01T00:00:00.000Z"), "1000000000000000000")).resolves.toBe(HASH);

    expect(client.writes[0]).toMatchObject({
      address: INFO.addresses.bountyEscrow,
      functionName: "fund",
      args: [onchainId("contract_1"), 1893456000n],
      value: 1000000000000000000n,
    });
  });

  it("stakes, disputes, rules, deletes, refunds and withdraws against the right contracts", async () => {
    const client = fakeClient();
    const calls = chainCalls(INFO, ANVIL_ACCOUNTS.auditor, client);
    await calls.stake("100000000000000000");
    await calls.openDispute("contract_1", "finding_1", "bad PoC");
    await calls.rule("contract_1", "finding_1", false);
    await calls.deleteBounty("contract_1");
    await calls.refund("contract_1");
    await calls.withdrawPayout();
    expect(client.writes.map((w) => [w.address, w.functionName])).toEqual([
      [INFO.addresses.auditorStaking, "stake"],
      [INFO.addresses.disputeResolution, "openDispute"],
      [INFO.addresses.disputeResolution, "rule"],
      [INFO.addresses.bountyEscrow, "deleteBounty"],
      [INFO.addresses.bountyEscrow, "refund"],
      [INFO.addresses.bountyEscrow, "withdrawPayout"],
    ]);
    expect(client.writes[0]!.value).toBe(100000000000000000n);
    expect(client.writes[2]!.args).toEqual([onchainId("contract_1"), onchainId("finding_1"), false]);
  });

  it("surfaces a revert from the simulation and never sends", async () => {
    const client = fakeClient({
      simulate: vi.fn(async () => {
        throw new ChainTxError("PastDeadline");
      }),
    });
    const calls = chainCalls(INFO, ANVIL_ACCOUNTS.developer, client);
    await expect(calls.fundBounty("contract_1", new Date("2020-01-01T00:00:00.000Z"), "1")).rejects.toThrow("PastDeadline");
    expect(client.write).not.toHaveBeenCalled();
  });

  it("fails when the receipt is not successful", async () => {
    const client = fakeClient({ waitForSuccess: vi.fn(async () => false) });
    await expect(chainCalls(INFO, ANVIL_ACCOUNTS.auditor, client).withdrawPayout()).rejects.toBeInstanceOf(ChainTxError);
  });
});
