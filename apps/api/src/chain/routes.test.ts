import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { buildApp } from "../app.js";
import type { ChainConfig } from "./config.js";

const CONFIG: ChainConfig = {
  rpcUrl: "http://anvil:8545",
  publicRpcUrl: "http://localhost:8545",
  chainId: 31337,
  operatorPrivateKey: `0x${"11".repeat(32)}`,
  auditorStakingAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address,
  bountyEscrowAddress: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address,
  disputeResolutionAddress: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address,
  arbiterAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
  challengeWindowSeconds: 60,
};

describe("GET /api/chain", () => {
  it("reports an unconfigured chain", async () => {
    const app = buildApp({ chainConfig: null });
    const res = await app.inject({ method: "GET", url: "/api/chain" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false });
  });

  it("describes the configured chain with the browser-facing RPC URL", async () => {
    const app = buildApp({ chainConfig: CONFIG });
    const res = await app.inject({ method: "GET", url: "/api/chain" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      configured: true,
      chainId: 31337,
      rpcUrl: "http://localhost:8545",
      addresses: {
        auditorStaking: CONFIG.auditorStakingAddress,
        bountyEscrow: CONFIG.bountyEscrowAddress,
        disputeResolution: CONFIG.disputeResolutionAddress,
      },
      arbiter: CONFIG.arbiterAddress,
      challengeWindowSeconds: 60,
      requiredStakeWei: "100000000000000000",
    });
  });
});

describe("GET /api/chain without a public RPC URL", () => {
  it("never publishes the internal RPC URL", async () => {
    const app = buildApp({ chainConfig: { ...CONFIG, publicRpcUrl: null } });
    const body = (await app.inject({ method: "GET", url: "/api/chain" })).json();
    expect(body.configured).toBe(true);
    expect(body).not.toHaveProperty("rpcUrl");
    expect(JSON.stringify(body)).not.toContain(CONFIG.rpcUrl);
  });
});
