import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { buildApp } from "../app.js";
import type { BountyEscrowPort, OnchainBounty } from "../chain/bounty-escrow.js";
import { onchainId } from "../chain/ids.js";
import { multipartBody } from "../testing/http.js";
import { AUDITOR, DEVELOPER, signIn } from "../testing/session.js";

const ZERO = `0x${"0".repeat(64)}` as Hex;
const NOBODY = "0x0000000000000000000000000000000000000000" as Address;
const DEADLINE = "2030-01-01T00:00:00.000Z";
const AMOUNT = "1000000000000000000";

function setup() {
  const bounties = new Map<Hex, OnchainBounty>();
  const bountyEscrow = {
    readBounty: vi.fn(
      async (id: Hex): Promise<OnchainBounty> =>
        bounties.get(id) ?? {
          developer: NOBODY,
          amount: 0n,
          deadline: 0n,
          state: 0,
          submissionCount: 0n,
          verifiedFinding: ZERO,
          verifiedAuditor: NOBODY,
          frozen: false,
        },
    ),
  } satisfies Pick<BountyEscrowPort, "readBounty">;
  const app = buildApp({ sessionSecret: "s", bountyEscrow });
  function fundOnChain(contractId: string, state = 1, developer: Address = DEVELOPER.address) {
    bounties.set(onchainId(contractId), {
      developer,
      amount: BigInt(AMOUNT),
      deadline: BigInt(Date.parse(DEADLINE) / 1000),
      state,
      submissionCount: 0n,
      verifiedFinding: ZERO,
      verifiedAuditor: NOBODY,
      frozen: false,
    });
  }
  async function upload(cookie: string, developerAddress: string = DEVELOPER.address) {
    return app.inject({
      method: "POST",
      url: "/api/contracts",
      headers: { cookie, ...multipartBody({}).headers },
      payload: multipartBody(
        { developerAddress, bountyAmount: AMOUNT, currency: "ETH", deadline: DEADLINE },
        { name: "Vault.sol", content: Buffer.from("pragma solidity ^0.8.19; contract V {}") },
      ).payload,
    });
  }
  return { app, bounties, fundOnChain, upload };
}

describe("contract lifecycle routes with a chain", () => {
  it("uploads as the signed-in developer and rejects another developerAddress", async () => {
    const { app, upload } = setup();
    const dev = await signIn(app, DEVELOPER);
    expect((await upload(dev)).statusCode).toBe(201);
    expect((await upload(dev, AUDITOR.address)).statusCode).toBe(403);
    expect((await upload("")).statusCode).toBe(401);
  });

  it("marks a bounty funded once the chain holds it, idempotently", async () => {
    const { app, upload, fundOnChain } = setup();
    const dev = await signIn(app, DEVELOPER);
    const id = (await upload(dev)).json().id as string;
    fundOnChain(id);
    for (let i = 0; i < 2; i += 1) {
      const res = await app.inject({ method: "POST", url: `/api/contracts/${id}/funded`, headers: { cookie: dev } });
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(id);
    }
  });

  it("refuses to mark funded when the chain does not hold the bounty", async () => {
    const { app, upload } = setup();
    const dev = await signIn(app, DEVELOPER);
    const id = (await upload(dev)).json().id as string;
    const res = await app.inject({ method: "POST", url: `/api/contracts/${id}/funded`, headers: { cookie: dev } });
    expect(res.statusCode).toBe(409);
    const queue = await app.inject({ method: "GET", url: "/api/auditor/queue" });
    expect(queue.json().map((c: { id: string }) => c.id)).not.toContain(id);
  });

  it("only the developer may mark their bounty funded", async () => {
    const { app, upload, fundOnChain } = setup();
    const id = (await upload(await signIn(app, DEVELOPER))).json().id as string;
    fundOnChain(id);
    const auditor = await signIn(app, AUDITOR);
    const res = await app.inject({ method: "POST", url: `/api/contracts/${id}/funded`, headers: { cookie: auditor } });
    expect(res.statusCode).toBe(403);
  });

  it("lists only funded contracts in the queue", async () => {
    const { app, upload, fundOnChain } = setup();
    const dev = await signIn(app, DEVELOPER);
    const funded = (await upload(dev)).json().id as string;
    const unfunded = (await upload(dev)).json().id as string;
    fundOnChain(funded);
    await app.inject({ method: "POST", url: `/api/contracts/${funded}/funded`, headers: { cookie: dev } });
    const ids = (await app.inject({ method: "GET", url: "/api/auditor/queue" })).json().map((c: { id: string }) => c.id);
    expect(ids).toContain(funded);
    expect(ids).not.toContain(unfunded);
  });

  it("cancel and reclaim expire the contract only after the bounty is closed on-chain", async () => {
    const { app, upload, fundOnChain } = setup();
    const dev = await signIn(app, DEVELOPER);
    for (const action of ["cancel", "reclaim"]) {
      const id = (await upload(dev)).json().id as string;
      fundOnChain(id, 1);
      const open = await app.inject({ method: "POST", url: `/api/contracts/${id}/${action}`, headers: { cookie: dev } });
      expect(open.statusCode).toBe(409);
      fundOnChain(id, 3);
      const closed = await app.inject({ method: "POST", url: `/api/contracts/${id}/${action}`, headers: { cookie: dev } });
      expect(closed.statusCode).toBe(200);
      expect(closed.json().status).toBe("Expired");
    }
  });

  it("claims for the signed-in auditor and rejects a different body auditorId", async () => {
    const { app, upload, fundOnChain } = setup();
    const dev = await signIn(app, DEVELOPER);
    const id = (await upload(dev)).json().id as string;
    fundOnChain(id);
    await app.inject({ method: "POST", url: `/api/contracts/${id}/funded`, headers: { cookie: dev } });
    const auditor = await signIn(app, AUDITOR);
    const wrong = await app.inject({
      method: "POST",
      url: "/api/auditor/claim",
      headers: { cookie: auditor },
      payload: { contractId: id, auditorId: DEVELOPER.address },
    });
    expect(wrong.statusCode).toBe(403);
    const noSession = await app.inject({ method: "POST", url: "/api/auditor/claim", payload: { contractId: id } });
    expect(noSession.statusCode).toBe(401);
    const ok = await app.inject({
      method: "POST",
      url: "/api/auditor/claim",
      headers: { cookie: auditor },
      payload: { contractId: id },
    });
    expect(ok.statusCode).toBe(200);
  });
});
