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
import { createChainActions } from "../chain/actions.js";
import { MemoryChainActionStore } from "../chain/memory-action-store.js";
import { MemoryContractRepository } from "../contracts/memory-repository.js";
import { MemorySourceStorage } from "../contracts/storage.js";
import { multipartBody } from "../testing/http.js";
import { makeContract, makeFinding } from "../testing/repository-suite.js";
import { MemoryPipelineRepository, MemoryStore } from "./memory-repository.js";
import { FixedVerdictSource } from "./verdict-source.js";

const T0 = new Date("2026-10-20T12:00:00.000Z");
const CLAIM_WINDOW_SECONDS = 600;
const developerAddress = "0x1234567890123456789012345678901234567890";
const auditorWallet = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const poc = Buffer.from('import "../src/Vault.sol";\ncontract PoC {}\n');

interface SetupOptions {
  verdicts?: FixedVerdictSource;
  /** Fake AuditorStaking reader. Omit to run with no chain configured. */
  stakeOf?: (auditor: string) => Promise<bigint>;
}

function setup(options: SetupOptions = {}) {
  const store = new MemoryStore();
  const storage = new MemorySourceStorage();
  const clock = { now: T0 };
  const app = buildApp({
    repository: new MemoryContractRepository(store),
    pipeline: new MemoryPipelineRepository(store),
    storage,
    config: { claimWindowSeconds: CLAIM_WINDOW_SECONDS, now: () => clock.now },
    verdicts: options.verdicts,
    stakeReader: options.stakeOf ? { stakeOf: options.stakeOf } : null,
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
    const clock = { now: T0 };
    // Keeps the lock count the way AuditorStaking does, since the chain actions
    // read it before each unlock.
    let active = 0n;
    const lock = vi.fn(async (auditor: Address) => {
      const hash = await lockImpl(auditor);
      active += 1n;
      return hash;
    });
    const unlock = vi.fn(async () => {
      active -= 1n;
      return LOCK_HASH;
    });
    const auditorStaking: AuditorStakingPort = {
      stakeOf: vi.fn(),
      activeSubmissions: vi.fn(async () => active),
      lockSubmission: lock,
      unlockSubmission: unlock,
    };
    const chainActions = createChainActions({
      store: new MemoryChainActionStore(store),
      auditorStaking,
      claimLockEnabled: true,
      now: () => clock.now,
    });
    const app = buildApp({
      repository,
      pipeline: new MemoryPipelineRepository(store),
      storage: new MemorySourceStorage(),
      config: { claimWindowSeconds: CLAIM_WINDOW_SECONDS, now: () => clock.now },
      chainActions,
    });
    const seedContract = async () => {
      const record = makeContract();
      await repository.insertContract(record);
      return record.contract;
    };
    const claim = (contractId: string, auditorId: string) =>
      app.inject({ method: "POST", url: "/api/auditor/claim", payload: { contractId, auditorId } });
    const queue = () => app.inject({ method: "GET", url: "/api/auditor/queue" });
    const advance = (seconds: number) => {
      clock.now = new Date(clock.now.getTime() + seconds * 1000);
    };
    return { app, repository, lock, unlock, seedContract, claim, queue, advance };
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

  it("returns 409 when the auditor already holds another claim, and does not lock", async () => {
    const { seedContract, claim, lock } = chainSetup();
    const first = await seedContract();
    const second = await seedContract();
    expect((await claim(first.id, AUDITOR_A)).statusCode).toBe(200);
    lock.mockClear();

    const response = await claim(second.id, AUDITOR_A);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "auditor already holds an active claim" });
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

  it("releases a lapsed lock once, on the first queue read after expiry", async () => {
    const { seedContract, claim, lock, unlock, queue, advance } = chainSetup();
    const contract = await seedContract();
    await claim(contract.id, AUDITOR_A);
    expect(lock).toHaveBeenCalledTimes(1);

    advance(CLAIM_WINDOW_SECONDS + 1);
    expect((await queue()).statusCode).toBe(200);
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalledWith(AUDITOR_A);

    await queue();
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it("releases the lapsed lock before a new claim replaces it", async () => {
    const { seedContract, claim, lock, unlock, advance } = chainSetup();
    const contract = await seedContract();
    await claim(contract.id, AUDITOR_A);

    advance(CLAIM_WINDOW_SECONDS + 1);
    const second = await claim(contract.id, AUDITOR_B);
    expect(second.statusCode).toBe(200);
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalledWith(AUDITOR_A);
    expect(lock).toHaveBeenLastCalledWith(AUDITOR_B);
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

describe("POST /api/auditor/claim when the lock and the release both fail", () => {
  const AUDITOR_A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

  it("answers 502, logs both failures, and leaves the claim standing until it expires", async () => {
    const store = new MemoryStore();
    const repository = new MemoryContractRepository(store);
    const releaseError = new Error("db connection lost");
    repository.releaseClaim = vi.fn().mockRejectedValue(releaseError);
    const lockError = new Error("rpc unavailable");
    const auditorStaking: AuditorStakingPort = {
      stakeOf: vi.fn(),
      activeSubmissions: vi.fn(),
      lockSubmission: vi.fn().mockRejectedValue(lockError),
      unlockSubmission: vi.fn(),
    };
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() };
    const app = buildApp({
      repository,
      pipeline: new MemoryPipelineRepository(store),
      storage: new MemorySourceStorage(),
      config: { claimWindowSeconds: CLAIM_WINDOW_SECONDS, now: () => T0 },
      auditorStaking,
    });
    // The app runs with logger: false, so capture what the route writes to
    // request.log by swapping in a spy logger for each request.
    app.addHook("onRequest", async (request) => {
      request.log = logger as unknown as typeof request.log;
    });
    const record = makeContract();
    await repository.insertContract(record);

    const response = await app.inject({
      method: "POST",
      url: "/api/auditor/claim",
      payload: { contractId: record.contract.id, auditorId: AUDITOR_A },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "Could not lock the auditor stake on-chain; claim not applied" });
    expect(auditorStaking.lockSubmission).toHaveBeenCalledWith(AUDITOR_A);
    expect(repository.releaseClaim).toHaveBeenCalledWith(record.contract.id, AUDITOR_A);
    expect(logger.error).toHaveBeenCalledWith(
      { err: lockError, contractId: record.contract.id, auditorId: AUDITOR_A },
      "lockSubmission failed; releasing claim",
    );
    expect(logger.error).toHaveBeenCalledWith(
      { err: releaseError, contractId: record.contract.id, auditorId: AUDITOR_A },
      "releaseClaim failed",
    );
    // The release failed, so the claim is still held (it expires after the window).
    expect((await repository.findActiveClaim(record.contract.id, T0))?.auditorId).toBe(AUDITOR_A);
    });
  });

describe("POST /api/auditor/poc verdicts and stake gate", () => {
  async function claimedBy(ctx: ReturnType<typeof setup>, auditorId: string) {
    const { contract } = await ctx.seedContract();
    const finding = ctx.seedFinding(contract.id);
    await ctx.claim(contract.id, auditorId);
    return finding;
  }

  it("requests a verdict for the stored PoC and returns Passed", async () => {
    const verdicts = new FixedVerdictSource("Passed");
    const ctx = setup({ verdicts });
    const finding = await claimedBy(ctx, "auditor_1");
    const response = await ctx.submitPoc(
      { findingId: finding.id, auditorId: "auditor_1" },
      { name: "Exploit.t.sol", content: poc },
    );
    expect(response.statusCode).toBe(201);
    const created = PoCSubmissionSchema.parse(response.json());
    expect(created.sandboxStatus).toBe("Passed");
    expect(verdicts.requested.map((p) => p.id)).toEqual([created.id]);
    expect(ctx.store.pocs.get(created.id)?.sandboxStatus).toBe("Passed");
  });

  it("returns Failed and records it when the verdict source fails the PoC", async () => {
    const verdicts = new FixedVerdictSource("Failed");
    const ctx = setup({ verdicts });
    const finding = await claimedBy(ctx, "auditor_1");
    const response = await ctx.submitPoc(
      { findingId: finding.id, auditorId: "auditor_1" },
      { name: "Exploit.t.sol", content: poc },
    );
    expect(response.statusCode).toBe(201);
    const created = PoCSubmissionSchema.parse(response.json());
    expect(created.sandboxStatus).toBe("Failed");
    expect(ctx.store.pocs.get(created.id)?.sandboxStatus).toBe("Failed");
  });

  it("rejects a stake below the requirement with 403 and stores nothing", async () => {
    const stakeOf = vi.fn(async () => 99_999_999_999_999_999n);
    const ctx = setup({ stakeOf });
    const finding = await claimedBy(ctx, auditorWallet);
    const put = vi.spyOn(ctx.storage, "put");
    const response = await ctx.submitPoc(
      { findingId: finding.id, auditorId: auditorWallet },
      { name: "Exploit.t.sol", content: poc },
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Auditor stake is below the required stake" });
    expect(stakeOf).toHaveBeenCalledWith(auditorWallet);
    expect(put).not.toHaveBeenCalled();
    expect(ctx.store.pocs.size).toBe(0);
    expect(ctx.store.findings.get(finding.id)?.status).toBe("Flagged");
  });

  it("accepts a stake equal to the requirement", async () => {
    const ctx = setup({ stakeOf: async () => 100_000_000_000_000_000n });
    const finding = await claimedBy(ctx, auditorWallet);
    const response = await ctx.submitPoc(
      { findingId: finding.id, auditorId: auditorWallet },
      { name: "Exploit.t.sol", content: poc },
    );
    expect(response.statusCode).toBe(201);
  });

  it("rejects a non-address auditorId when the stake check is on, without reading stake", async () => {
    const stakeOf = vi.fn(async () => 100_000_000_000_000_000n);
    const ctx = setup({ stakeOf });
    const finding = await claimedBy(ctx, "auditor_1");
    const response = await ctx.submitPoc(
      { findingId: finding.id, auditorId: "auditor_1" },
      { name: "Exploit.t.sol", content: poc },
    );
    expect(response.statusCode).toBe(400);
    expect(stakeOf).not.toHaveBeenCalled();
  });

  it("skips the stake check and logs it when no chain is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ctx = setup();
      const finding = await claimedBy(ctx, "auditor_1");
      const response = await ctx.submitPoc(
        { findingId: finding.id, auditorId: "auditor_1" },
        { name: "Exploit.t.sol", content: poc },
      );
      expect(response.statusCode).toBe(201);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("stake check skipped"));
    } finally {
      warn.mockRestore();
    }
  });
});
