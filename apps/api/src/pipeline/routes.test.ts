import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import {
  AnalysisStatusSchema,
  ContractSchema,
  FindingSchema,
  PoCSubmissionSchema,
  POC_SOURCE_MAX_BYTES,
} from "@bbm/shared";
import { buildApp } from "../app.js";
import type { AuditorStakingPort } from "../chain/auditor-staking.js";
import { MemoryContractRepository } from "../contracts/memory-repository.js";
import { MemorySourceStorage } from "../contracts/storage.js";
import { multipartBody } from "../testing/http.js";
import { makeContract, makeFinding } from "../testing/repository-suite.js";
import { MemoryPipelineRepository, MemoryStore } from "./memory-repository.js";

const T0 = new Date("2026-10-20T12:00:00.000Z");
const CLAIM_WINDOW_SECONDS = 600;
const developerAddress = "0x1234567890123456789012345678901234567890";
const poc = Buffer.from('import "../src/Vault.sol";\ncontract PoC {}\n');

function setup() {
  const store = new MemoryStore();
  const storage = new MemorySourceStorage();
  const clock = { now: T0 };
  const app = buildApp({
    repository: new MemoryContractRepository(store),
    pipeline: new MemoryPipelineRepository(store),
    storage,
    config: { claimWindowSeconds: CLAIM_WINDOW_SECONDS, now: () => clock.now },
  });
  const advance = (seconds: number) => {
    clock.now = new Date(clock.now.getTime() + seconds * 1000);
  };
  async function seedContract(overrides: Parameters<typeof makeContract>[0] = {}) {
    const record = makeContract(overrides);
    await new MemoryContractRepository(store).insertContract(record);
    return record;
  }
  function seedFinding(contractId: string, overrides: Parameters<typeof makeFinding>[1] = {}) {
    const finding = makeFinding(contractId, overrides);
    store.findings.set(finding.id, finding);
    return finding;
  }
  function claim(contractId: string, auditorId = "auditor_1") {
    return app.inject({
      method: "POST",
      url: "/api/auditor/claim",
      payload: { contractId, auditorId },
    });
  }
  function submitPoc(fields: Record<string, string>, file?: { name: string; content: Buffer }) {
    const body = multipartBody(fields, file);
    return app.inject({ method: "POST", url: "/api/auditor/poc", ...body });
  }
  return { app, store, storage, advance, seedContract, seedFinding, claim, submitPoc };
}

describe("GET /api/contracts", () => {
  it("lists only the given developer's contracts", async () => {
    const { app, seedContract } = setup();
    const mine = await seedContract({ developerAddress });
    await seedContract({ developerAddress: "0x9999999999999999999999999999999999999999" });
    const response = await app.inject({
      url: `/api/contracts?developerAddress=${developerAddress}`,
    });
    expect(response.statusCode).toBe(200);
    const listed = ContractSchema.array().parse(response.json());
    expect(listed.map((c) => c.id)).toEqual([mine.contract.id]);
  });

  it("rejects a malformed address with 400", async () => {
    const { app } = setup();
    const response = await app.inject({ url: "/api/contracts?developerAddress=bad" });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/contracts/:id/findings", () => {
  it("returns schema-valid findings for the contract", async () => {
    const { app, seedContract, seedFinding } = setup();
    const { contract } = await seedContract();
    seedFinding(contract.id);
    const response = await app.inject({ url: `/api/contracts/${contract.id}/findings` });
    expect(response.statusCode).toBe(200);
    expect(FindingSchema.array().parse(response.json())).toHaveLength(1);
  });

  it("returns 404 for an unknown contract", async () => {
    const { app } = setup();
    expect((await app.inject({ url: "/api/contracts/contract_missing/findings" })).statusCode).toBe(
      404,
    );
  });
});

describe("GET /api/contracts/:id/analysis", () => {
  it("is Queued right after the contract is submitted", async () => {
    const { app } = setup();
    const body = multipartBody(
      {
        developerAddress,
        bountyAmount: "1",
        currency: "ETH",
        deadline: "2030-01-01T00:00:00.000Z",
      },
      { name: "Vault.sol", content: Buffer.from("pragma solidity ^0.8.19;\ncontract Vault {}\n") },
    );
    const created = await app.inject({ method: "POST", url: "/api/contracts", ...body });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    const response = await app.inject({ url: `/api/contracts/${id}/analysis` });
    expect(response.statusCode).toBe(200);
    expect(AnalysisStatusSchema.parse(response.json())).toMatchObject({
      status: "Queued",
      findingCount: 0,
    });
  });

  it("returns 404 for an unknown contract", async () => {
    const { app } = setup();
    expect((await app.inject({ url: "/api/contracts/contract_missing/analysis" })).statusCode).toBe(
      404,
    );
  });
});

describe("GET /api/findings/:id/raw", () => {
  it("returns the stored Slither detector JSON", async () => {
    const { app, seedContract, seedFinding } = setup();
    const { contract } = await seedContract();
    const finding = seedFinding(contract.id, {
      rawOutput: { check: "reentrancy-eth", elements: [] },
    });
    const response = await app.inject({ url: finding.rawOutputReference });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ check: "reentrancy-eth", elements: [] });
  });

  it("returns 404 for an unknown finding", async () => {
    const { app } = setup();
    expect((await app.inject({ url: "/api/findings/finding_missing/raw" })).statusCode).toBe(404);
  });
});

describe("GET /api/auditor/queue", () => {
  it("sorts by bounty, largest first", async () => {
    const { app, seedContract, store } = setup();
    const small = await seedContract();
    const big = await seedContract();
    store.bounties.get(big.bounty.id)!.amount = "9000000000000000000";
    const response = await app.inject({ url: "/api/auditor/queue?sort=bounty" });
    expect(response.statusCode).toBe(200);
    const ids = (response.json() as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toEqual([big.contract.id, small.contract.id]);
  });

  it("sorts by newest first", async () => {
    const { app, seedContract } = setup();
    const older = await seedContract({ createdAt: "2026-10-01T00:00:00.000Z" });
    const newer = await seedContract({ createdAt: "2026-10-02T00:00:00.000Z" });
    const response = await app.inject({ url: "/api/auditor/queue?sort=newest" });
    expect((response.json() as Array<{ id: string }>).map((c) => c.id)).toEqual([
      newer.contract.id,
      older.contract.id,
    ]);
  });

  it("rejects an unknown sort with 400", async () => {
    const { app } = setup();
    expect((await app.inject({ url: "/api/auditor/queue?sort=bad" })).statusCode).toBe(400);
  });
});

describe("POST /api/auditor/claim", () => {
  it("claims once, conflicts for a second auditor, then reopens after the claim window", async () => {
    const { seedContract, claim, advance } = setup();
    const { contract } = await seedContract();

    const first = await claim(contract.id, "auditor_1");
    expect(first.statusCode).toBe(200);
    expect(ContractSchema.parse(first.json()).status).toBe("Claimed");

    const second = await claim(contract.id, "auditor_2");
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: `Contract ${contract.id} is not open to claim` });

    advance(CLAIM_WINDOW_SECONDS);
    expect((await claim(contract.id, "auditor_2")).statusCode).toBe(200);
  });

  it("requires contractId and auditorId", async () => {
    const { app } = setup();
    const response = await app.inject({ method: "POST", url: "/api/auditor/claim", payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "contractId and auditorId are required" });
  });

  it("returns 404 for an unknown contract", async () => {
    const { claim } = setup();
    expect((await claim("contract_missing")).statusCode).toBe(404);
  });
});

describe("POST /api/auditor/poc", () => {
  async function claimedFinding(ctx: ReturnType<typeof setup>) {
    const { contract } = await ctx.seedContract();
    const finding = ctx.seedFinding(contract.id);
    await ctx.claim(contract.id, "auditor_1");
    return finding;
  }

  it("stores the PoC, marks the finding Submitted, and queues the sandbox", async () => {
    const ctx = setup();
    const finding = await claimedFinding(ctx);

    const response = await ctx.submitPoc(
      { findingId: finding.id, auditorId: "auditor_1" },
      { name: "Exploit.t.sol", content: poc },
    );

    expect(response.statusCode).toBe(201);
    const created = PoCSubmissionSchema.parse(response.json());
    expect(created).toMatchObject({
      findingId: finding.id,
      auditorId: "auditor_1",
      sandboxStatus: "Pending",
    });
    const sha = createHash("sha256").update(poc).digest("hex");
    expect(created.testFileReference).toBe(`pocs/${created.id}/${sha}.t.sol`);
    expect(await ctx.storage.get(created.testFileReference)).toEqual(poc);
    expect(ctx.store.findings.get(finding.id)?.status).toBe("Submitted");
    expect(
      [...ctx.store.jobs.values()].some((j) => j.kind === "sandbox" && j.subjectId === created.id),
    ).toBe(true);
  });

  it("rejects a non-.t.sol filename with 400", async () => {
    const ctx = setup();
    const finding = await claimedFinding(ctx);
    const response = await ctx.submitPoc(
      { findingId: finding.id, auditorId: "auditor_1" },
      { name: "Exploit.sol", content: poc },
    );
    expect(response.statusCode).toBe(400);
  });

  it("rejects a file over the limit with 413", async () => {
    const ctx = setup();
    const finding = await claimedFinding(ctx);
    const response = await ctx.submitPoc(
      { findingId: finding.id, auditorId: "auditor_1" },
      { name: "Exploit.t.sol", content: Buffer.alloc(POC_SOURCE_MAX_BYTES + 1, 0x61) },
    );
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: "PoC file exceeds the 100 KB limit" });
  });

  it("requires findingId, auditorId and file", async () => {
    const ctx = setup();
    const response = await ctx.submitPoc({ findingId: "finding_x" });
    expect(response.statusCode).toBe(400);
  });

  it("returns 404 for an unknown finding", async () => {
    const ctx = setup();
    const response = await ctx.submitPoc(
      { findingId: "finding_missing", auditorId: "auditor_1" },
      { name: "Exploit.t.sol", content: poc },
    );
    expect(response.statusCode).toBe(404);
  });

  it("returns 403 when the auditor holds no claim", async () => {
    const ctx = setup();
    const { contract } = await ctx.seedContract();
    const finding = ctx.seedFinding(contract.id);
    const response = await ctx.submitPoc(
      { findingId: finding.id, auditorId: "auditor_1" },
      { name: "Exploit.t.sol", content: poc },
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "You do not hold an active claim on this contract" });
  });

  it("returns 403 when another auditor holds the claim", async () => {
    const ctx = setup();
    const finding = await claimedFinding(ctx);
    const response = await ctx.submitPoc(
      { findingId: finding.id, auditorId: "auditor_2" },
      { name: "Exploit.t.sol", content: poc },
    );
    expect(response.statusCode).toBe(403);
  });

  it("returns 403 once the claim has expired", async () => {
    const ctx = setup();
    const finding = await claimedFinding(ctx);
    ctx.advance(CLAIM_WINDOW_SECONDS);
    const response = await ctx.submitPoc(
      { findingId: finding.id, auditorId: "auditor_1" },
      { name: "Exploit.t.sol", content: poc },
    );
    expect(response.statusCode).toBe(403);
  });

  it("returns 409 when the finding is no longer Flagged", async () => {
    const ctx = setup();
    const finding = await claimedFinding(ctx);
    const first = await ctx.submitPoc(
      { findingId: finding.id, auditorId: "auditor_1" },
      { name: "Exploit.t.sol", content: poc },
    );
    expect(first.statusCode).toBe(201);
    const second = await ctx.submitPoc(
      { findingId: finding.id, auditorId: "auditor_1" },
      { name: "Exploit.t.sol", content: poc },
    );
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "Finding is not Flagged" });
  });
});

describe("POST /api/auditor/claim with an on-chain lock", () => {
  const AUDITOR_A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
  const AUDITOR_B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
  const LOCK_HASH = `0x${"cd".repeat(32)}` as Hash;

  function chainSetup(lockImpl: (auditor: Address) => Promise<Hash> = async () => LOCK_HASH) {
    const store = new MemoryStore();
    const repository = new MemoryContractRepository(store);
    const lock = vi.fn(lockImpl);
    const auditorStaking: AuditorStakingPort = {
      stakeOf: vi.fn(),
      activeSubmissions: vi.fn(),
      lockSubmission: lock,
      unlockSubmission: vi.fn(),
    };
    const app = buildApp({
      repository,
      pipeline: new MemoryPipelineRepository(store),
      storage: new MemorySourceStorage(),
      config: { claimWindowSeconds: CLAIM_WINDOW_SECONDS, now: () => T0 },
      auditorStaking,
    });
    const seedContract = async () => {
      const record = makeContract();
      await repository.insertContract(record);
      return record.contract;
    };
    const claim = (contractId: string, auditorId: string) =>
      app.inject({ method: "POST", url: "/api/auditor/claim", payload: { contractId, auditorId } });
    return { app, repository, lock, seedContract, claim };
  }

  it("locks the auditor's stake after a successful claim", async () => {
    const { seedContract, claim, lock } = chainSetup();
    const contract = await seedContract();

    const response = await claim(contract.id, AUDITOR_A);
    expect(response.statusCode).toBe(200);
    expect(ContractSchema.parse(response.json()).status).toBe("Claimed");
    expect(lock).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledWith(AUDITOR_A);
  });

  it("returns 409 and does not lock when the contract is not open", async () => {
    const { seedContract, claim, lock } = chainSetup();
    const contract = await seedContract();
    await claim(contract.id, AUDITOR_A);
    lock.mockClear();

    const second = await claim(contract.id, AUDITOR_B);
    expect(second.statusCode).toBe(409);
    expect(lock).not.toHaveBeenCalled();
  });

  it("returns 502, releases the claim and does not apply it when the lock fails", async () => {
    const { seedContract, repository, claim, lock } = chainSetup(async (auditor) => {
      if (auditor === AUDITOR_A) throw new Error("rpc unavailable");
      return LOCK_HASH;
    });
    const contract = await seedContract();

    const failed = await claim(contract.id, AUDITOR_A);
    expect(failed.statusCode).toBe(502);
    expect(lock).toHaveBeenCalledWith(AUDITOR_A);
    expect(await repository.findActiveClaim(contract.id, T0)).toBeNull();
    expect((await repository.findContractById(contract.id, T0))?.status).toBe("Open");

    // The contract is open again, so another auditor can claim it.
    const retry = await claim(contract.id, AUDITOR_B);
    expect(retry.statusCode).toBe(200);
    expect(lock).toHaveBeenLastCalledWith(AUDITOR_B);
  });

  it("rejects a non-address auditorId before claiming, so no lock is sent", async () => {
    const { seedContract, repository, claim, lock } = chainSetup();
    const contract = await seedContract();

    const response = await claim(contract.id, "auditor_1");
    expect(response.statusCode).toBe(400);
    expect(lock).not.toHaveBeenCalled();
    expect(await repository.findActiveClaim(contract.id, T0)).toBeNull();
  });

  it("skips the lock entirely when no chain is configured", async () => {
    const ctx = setup();
    const { contract } = await ctx.seedContract();
    // Without a port the route never reaches for the chain, so a plain
    // non-address auditor id still claims.
    const response = await ctx.claim(contract.id, "auditor_1");
    expect(response.statusCode).toBe(200);
  });
});

describe("POST /api/auditor/poc when the claim lapses mid-request", () => {
  it("answers 403 when the repository's in-transaction claim check fails", async () => {
    const ctx = setup();
    const { contract } = await ctx.seedContract();
    const finding = ctx.seedFinding(contract.id);
    await ctx.claim(contract.id, "auditor_1");
    // The route's pre-check passes; the claim is gone by the time submitPoc
    // re-checks it inside its transaction.
    const pipeline = new MemoryPipelineRepository(ctx.store);
    pipeline.submitPoc = async () => "no_claim";
    const app = buildApp({
      repository: new MemoryContractRepository(ctx.store),
      pipeline,
      storage: ctx.storage,
      config: { claimWindowSeconds: CLAIM_WINDOW_SECONDS, now: () => T0 },
    });
    const body = multipartBody(
      { findingId: finding.id, auditorId: "auditor_1" },
      { name: "Exploit.t.sol", content: poc },
    );
    const response = await app.inject({ method: "POST", url: "/api/auditor/poc", ...body });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "You do not hold an active claim on this contract" });
  });
});
