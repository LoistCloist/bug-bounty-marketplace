import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { FindingSchema, type Bounty, type Contract, type PoCSubmission } from "@bbm/shared";
import type { ContractRepository } from "../contracts/repository.js";
import type {
  FindingRecord,
  JobStatus,
  NewJob,
  PipelineRepository,
} from "../pipeline/repository.js";

/** What the shared repository tests need from an implementation. Test-only
 * hooks (seeding findings, failing jobs) stand in for the Python worker. */
export interface RepositoryHarness {
  contracts: ContractRepository;
  pipeline: PipelineRepository;
  seedFinding(record: FindingRecord): Promise<void>;
  setJobStatus(jobId: string, status: JobStatus, lastError?: string): Promise<void>;
  jobsFor(subjectId: string): Promise<Array<{ kind: string; status: JobStatus }>>;
  /** Removes what the tests have inserted so far, so the next test starts with
   * no claims. The auditors in these tests hold one claim at a time. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

const T0 = new Date("2026-10-20T12:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

export function makeContract(overrides: Partial<Contract> = {}) {
  const id = `contract_${randomUUID()}`;
  const bountyId = `bounty_${randomUUID()}`;
  const contract: Contract = {
    id,
    developerAddress: "0x1234567890123456789012345678901234567890",
    filename: "Vault.sol",
    sourceHash: "a".repeat(64),
    sourceReference: `contracts/${id}/${"a".repeat(64)}.sol`,
    bountyId,
    status: "Open",
    createdAt: T0.toISOString(),
    deadline: "2030-01-01T00:00:00.000Z",
    ...overrides,
  };
  const bounty: Bounty = {
    id: bountyId,
    contractId: id,
    amount: "2000000000000000000",
    currency: "ETH",
    fundedAt: contract.createdAt,
    deadline: contract.deadline,
  };
  const analysisJob: NewJob = {
    id: `job_${randomUUID()}`,
    kind: "analysis",
    subjectId: id,
    createdAt: contract.createdAt,
  };
  return { contract, bounty, analysisJob };
}

export function makeFinding(
  contractId: string,
  overrides: Partial<FindingRecord> = {},
): FindingRecord {
  const id = `finding_${randomUUID()}`;
  return {
    id,
    contractId,
    severity: "High",
    slitherDetector: "reentrancy-eth",
    slitherConfidence: "Medium",
    rawOutput: { check: "reentrancy-eth", impact: "High" },
    rawOutputReference: `/api/findings/${id}/raw`,
    llmExplanation: "Funds can be drained by re-entering withdraw().",
    explanationSource: "llm",
    status: "Flagged",
    statusHistory: [{ status: "Flagged", changedAt: T0.toISOString() }],
    isFalsePositive: false,
    challengeWindowExpiresAt: null,
    createdAt: T0.toISOString(),
    ...overrides,
  };
}

function makePoc(findingId: string): { poc: PoCSubmission; job: NewJob } {
  const id = `poc_${randomUUID()}`;
  return {
    poc: {
      id,
      findingId,
      auditorId: "auditor_1",
      testFileReference: `pocs/${id}/${"b".repeat(64)}.t.sol`,
      submittedAt: minutes(1).toISOString(),
      sandboxStatus: "Pending",
      sandboxLog: null,
    },
    job: {
      id: `job_${randomUUID()}`,
      kind: "sandbox",
      subjectId: id,
      createdAt: minutes(1).toISOString(),
    },
  };
}

/** Registers the shared repository behaviour tests for one implementation. */
export function describeRepositories(
  name: string,
  makeHarness: () => RepositoryHarness,
  options: { concurrent?: boolean; skip?: boolean } = {},
): void {
  describe.skipIf(options.skip ?? false)(`${name} repositories`, () => {
    const h = options.skip ? (undefined as unknown as RepositoryHarness) : makeHarness();

    afterEach(async () => {
      await h?.reset();
    });

    afterAll(async () => {
      await h?.close();
    });

    async function insert(overrides: Partial<Contract> = {}) {
      const record = makeContract(overrides);
      await h.contracts.insertContract(record);
      return record;
    }

    it("insertContract also queues an analysis job", async () => {
      const { contract } = await insert();
      expect(await h.jobsFor(contract.id)).toEqual([{ kind: "analysis", status: "queued" }]);
      expect(await h.pipeline.getAnalysisStatus(contract.id)).toEqual({
        contractId: contract.id,
        status: "Queued",
        error: null,
        findingCount: 0,
        updatedAt: contract.createdAt,
      });
    });

    it("getAnalysisStatus returns null for a contract without a job", async () => {
      expect(await h.pipeline.getAnalysisStatus(`contract_${randomUUID()}`)).toBeNull();
    });

    it("getAnalysisStatus exposes last_error only once the job has failed", async () => {
      const { contract, analysisJob } = await insert();
      await h.setJobStatus(analysisJob.id, "running", "transient");
      expect((await h.pipeline.getAnalysisStatus(contract.id))?.error).toBeNull();
      await h.setJobStatus(analysisJob.id, "failed", "ParserError: Expected ';'");
      const status = await h.pipeline.getAnalysisStatus(contract.id);
      expect(status?.status).toBe("Failed");
      expect(status?.error).toBe("ParserError: Expected ';'");
    });

    it("listContracts filters by developer (ignoring case), newest first", async () => {
      const developerAddress = `0x${randomUUID().replace(/-/g, "").padEnd(40, "0").slice(0, 40)}`;
      const older = await insert({ developerAddress, createdAt: minutes(-5).toISOString() });
      const newer = await insert({ developerAddress, createdAt: minutes(5).toISOString() });
      await insert();
      const listed = await h.contracts.listContracts(
        { developerAddress: developerAddress.toUpperCase().replace("0X", "0x") },
        T0,
      );
      expect(listed.map((c) => c.id)).toEqual([newer.contract.id, older.contract.id]);
    });

    it("claim succeeds once; a second claim is not_open", async () => {
      const { contract } = await insert();
      const first = await h.contracts.claimContract(contract.id, "auditor_1", minutes(10), T0);
      expect(first).toEqual({ ok: true, contract: { ...contract, status: "Claimed" } });
      expect(await h.contracts.claimContract(contract.id, "auditor_2", minutes(10), T0)).toEqual({
        ok: false,
        reason: "not_open",
      });
      expect(await h.contracts.findActiveClaim(contract.id, T0)).toEqual({
        auditorId: "auditor_1",
        expiresAt: minutes(10),
      });
    });

    it("claiming an unknown contract is not_found", async () => {
      expect(
        await h.contracts.claimContract("contract_missing", "auditor_1", minutes(10), T0),
      ).toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    it("an expired claim reads back as Open and can be claimed again", async () => {
      const { contract } = await insert();
      await h.contracts.claimContract(contract.id, "auditor_1", minutes(10), T0);
      expect((await h.contracts.findContractById(contract.id, minutes(9)))?.status).toBe("Claimed");
      expect((await h.contracts.findContractById(contract.id, minutes(10)))?.status).toBe("Open");
      expect(await h.contracts.findActiveClaim(contract.id, minutes(10))).toBeNull();
      const again = await h.contracts.claimContract(
        contract.id,
        "auditor_2",
        minutes(20),
        minutes(10),
      );
      expect(again.ok).toBe(true);
      expect(await h.contracts.findActiveClaim(contract.id, minutes(11))).toEqual({
        auditorId: "auditor_2",
        expiresAt: minutes(20),
      });
    });

    it("an auditor holds one claim at a time, across contracts", async () => {
      const first = await insert();
      const second = await insert();
      expect((await h.contracts.claimContract(first.contract.id, "auditor_1", minutes(10), T0)).ok).toBe(true);
      expect(await h.contracts.claimContract(second.contract.id, "auditor_1", minutes(10), T0)).toEqual({
        ok: false,
        reason: "auditor_has_claim",
      });
      expect((await h.contracts.claimContract(second.contract.id, "auditor_2", minutes(10), T0)).ok).toBe(true);
      // Once the first claim has expired, the auditor may claim again.
      const third = await insert();
      expect((await h.contracts.claimContract(third.contract.id, "auditor_1", minutes(20), minutes(10))).ok).toBe(
        true,
      );
    });

    if (options.concurrent) {
      it("of two simultaneous claims by one auditor on different contracts, exactly one succeeds", async () => {
        const a = await insert();
        const b = await insert();
        const results = await Promise.all([
          h.contracts.claimContract(a.contract.id, "auditor_1", minutes(10), T0),
          h.contracts.claimContract(b.contract.id, "auditor_1", minutes(10), T0),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
      });

      it("of two simultaneous claims exactly one succeeds", async () => {
        const { contract } = await insert();
        const results = await Promise.all([
          h.contracts.claimContract(contract.id, "auditor_1", minutes(10), T0),
          h.contracts.claimContract(contract.id, "auditor_2", minutes(10), T0),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
      });
    }

    it("listQueue includes Open and expired claims, not active claims, with the bounty", async () => {
      const open = await insert();
      const active = await insert();
      const expired = await insert();
      await h.contracts.claimContract(active.contract.id, "auditor_1", minutes(30), T0);
      // A different auditor: auditor_1 already holds the active claim above, and
      // one auditor may hold one claim at a time.
      expect(
        (await h.contracts.claimContract(expired.contract.id, "auditor_2", minutes(5), T0)).ok,
      ).toBe(true);
      const queue = await h.contracts.listQueue(minutes(10));
      const ids = queue.map((c) => c.id);
      expect(ids).toContain(open.contract.id);
      expect(ids).toContain(expired.contract.id);
      expect(ids).not.toContain(active.contract.id);
      const item = queue.find((c) => c.id === expired.contract.id);
      expect(item).toEqual({
        ...expired.contract,
        status: "Open",
        bounty: { amount: "2000000000000000000", currency: "ETH" },
      });
    });

    it("listFindings orders by severity and fills in the active claim", async () => {
      const { contract } = await insert();
      const low = makeFinding(contract.id, { severity: "Low" });
      const high = makeFinding(contract.id, {
        severity: "High",
        createdAt: minutes(1).toISOString(),
      });
      const critical = makeFinding(contract.id, {
        severity: "Critical",
        createdAt: minutes(2).toISOString(),
      });
      for (const f of [low, high, critical]) await h.seedFinding(f);

      const unclaimed = await h.pipeline.listFindings(contract.id, T0);
      expect(unclaimed.map((f) => f.id)).toEqual([critical.id, high.id, low.id]);
      expect(unclaimed[0]).toMatchObject({ claimedByAuditorId: null, claimExpiresAt: null });
      for (const f of unclaimed) FindingSchema.parse(f);

      await h.contracts.claimContract(contract.id, "auditor_1", minutes(10), T0);
      const claimed = await h.pipeline.listFindings(contract.id, minutes(1));
      expect(claimed[0]).toMatchObject({
        claimedByAuditorId: "auditor_1",
        claimExpiresAt: minutes(10).toISOString(),
      });
      const afterExpiry = await h.pipeline.listFindings(contract.id, minutes(10));
      expect(afterExpiry[0]).toMatchObject({ claimedByAuditorId: null, claimExpiresAt: null });
    });

    it("findFinding returns the finding with its contract; getRawOutput returns the stored JSON", async () => {
      const { contract } = await insert();
      const finding = makeFinding(contract.id, {
        rawOutput: { check: "tx-origin", elements: [1, 2] },
      });
      await h.seedFinding(finding);
      const found = await h.pipeline.findFinding(finding.id, T0);
      expect(found?.contract.id).toBe(contract.id);
      expect(found?.slitherDetector).toBe("reentrancy-eth");
      expect(await h.pipeline.getRawOutput(finding.id)).toEqual({
        check: "tx-origin",
        elements: [1, 2],
      });
      expect(await h.pipeline.findFinding("finding_missing", T0)).toBeNull();
      expect(await h.pipeline.getRawOutput("finding_missing")).toBeNull();
    });

    it("getAnalysisStatus counts stored findings", async () => {
      const { contract } = await insert();
      await h.seedFinding(makeFinding(contract.id));
      await h.seedFinding(makeFinding(contract.id));
      expect((await h.pipeline.getAnalysisStatus(contract.id))?.findingCount).toBe(2);
    });

    it("submitPoc on a Flagged finding marks it Submitted and queues a sandbox job", async () => {
      const { contract } = await insert();
      const finding = makeFinding(contract.id);
      await h.seedFinding(finding);
      await h.contracts.claimContract(contract.id, "auditor_1", minutes(10), T0);
      const { poc, job } = makePoc(finding.id);

      expect(
        await h.pipeline.submitPoc({ poc, job, findingId: finding.id, now: poc.submittedAt }),
      ).toBe("ok");

      const stored = await h.pipeline.findFinding(finding.id, T0);
      expect(stored?.status).toBe("Submitted");
      expect(stored?.statusHistory).toEqual([
        { status: "Flagged", changedAt: T0.toISOString() },
        { status: "Submitted", changedAt: poc.submittedAt },
      ]);
      expect(await h.jobsFor(poc.id)).toEqual([{ kind: "sandbox", status: "queued" }]);
    });

    it("a second submitPoc on the same finding is not_flagged and writes nothing", async () => {
      const { contract } = await insert();
      const finding = makeFinding(contract.id);
      await h.seedFinding(finding);
      await h.contracts.claimContract(contract.id, "auditor_1", minutes(10), T0);
      const first = makePoc(finding.id);
      await h.pipeline.submitPoc({ ...first, findingId: finding.id, now: first.poc.submittedAt });

      const second = makePoc(finding.id);
      expect(
        await h.pipeline.submitPoc({
          ...second,
          findingId: finding.id,
          now: second.poc.submittedAt,
        }),
      ).toBe("not_flagged");
      expect(await h.jobsFor(second.poc.id)).toEqual([]);
      expect((await h.pipeline.findFinding(finding.id, T0))?.statusHistory).toHaveLength(2);
    });

    // The claim is re-checked inside the same transaction as the status
    // change, so a claim that lapses (or changes hands) mid-request loses.
    for (const [label, claimant, expiresAt] of [
      ["no claim", null, null],
      ["another auditor's claim", "auditor_2", minutes(10)],
      ["an expired claim", "auditor_1", minutes(1)],
    ] as const) {
      it(`submitPoc with ${label} is no_claim and writes nothing`, async () => {
        const { contract } = await insert();
        const finding = makeFinding(contract.id);
        await h.seedFinding(finding);
        if (claimant && expiresAt) {
          await h.contracts.claimContract(contract.id, claimant, expiresAt, T0);
        }
        const { poc, job } = makePoc(finding.id); // auditor_1, submitted at T0 + 1 min
        expect(
          await h.pipeline.submitPoc({ poc, job, findingId: finding.id, now: poc.submittedAt }),
        ).toBe("no_claim");
        expect(await h.jobsFor(poc.id)).toEqual([]);
        expect((await h.pipeline.findFinding(finding.id, T0))?.status).toBe("Flagged");
      });
    }
  });
}
