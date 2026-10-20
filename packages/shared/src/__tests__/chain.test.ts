import { describe, expect, it } from "vitest";
import { ChainInfoSchema } from "../chain";

const A = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const B = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const C = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const D = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("ChainInfoSchema", () => {
  it("accepts the unconfigured variant", () => {
    expect(ChainInfoSchema.parse({ configured: false })).toEqual({ configured: false });
  });

  it("accepts a configured chain", () => {
    const info = {
      configured: true,
      chainId: 31337,
      rpcUrl: "http://localhost:8545",
      addresses: { auditorStaking: A, bountyEscrow: B, disputeResolution: C },
      arbiter: D,
      challengeWindowSeconds: 60,
      requiredStakeWei: "100000000000000000",
    };
    expect(ChainInfoSchema.parse(info)).toEqual(info);
  });

  it("rejects a configured chain without addresses", () => {
    expect(() =>
      ChainInfoSchema.parse({
        configured: true,
        chainId: 31337,
        rpcUrl: "http://localhost:8545",
        arbiter: D,
        challengeWindowSeconds: 60,
        requiredStakeWei: "1",
      }),
    ).toThrow();
  });
});
