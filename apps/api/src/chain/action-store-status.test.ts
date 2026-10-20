import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { FindingStatus } from "@bbm/shared";
import { MemoryContractRepository } from "../contracts/memory-repository.js";
import { PgContractRepository } from "../contracts/pg-repository.js";
import type { ContractRepository } from "../contracts/repository.js";
import { runMigrations } from "../db/migrate.js";
import { MemoryStore } from "../pipeline/memory-repository.js";
import { PgPipelineRepository } from "../pipeline/pg-repository.js";
import type { FindingRecord } from "../pipeline/repository.js";
import { InvalidTransitionError } from "../status/transitions.js";
import { makeContract, makeFinding } from "../testing/repository-suite.js";
import type { ChainActionStore } from "./action-store.js";
import { MemoryChainActionStore } from "./memory-action-store.js";
import { PgChainActionStore } from "./pg-action-store.js";

// Postgres runs only with DATABASE_URL set, like the other pg suites.
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;
const createdContracts: string[] = [];

beforeAll(async () => {
  if (pool) await runMigrations(pool);
});

afterAll(async () => {
  if (pool && createdContracts.length > 0) {
    await pool.query("DELETE FROM jobs WHERE subject_id = ANY($1)", [createdContracts]);
    await pool.query("DELETE FROM findings WHERE contract_id = ANY($1)", [createdContracts]);
    await pool.query("DELETE FROM contracts WHERE id = ANY($1)", [createdContracts]);
    await pool.query("DELETE FROM bounties WHERE contract_id = ANY($1)", [createdContracts]);
  }
  await pool?.end();
});

interface Harness {
  store: ChainActionStore;
  contracts: ContractRepository;
  seed(record: FindingRecord): Promise<void>;
  finding(id: string): Promise<{ status: FindingStatus; history: number; window: string | null }>;
}

const WINDOW_SECONDS = 60;
const AT = "2026-10-20T12:00:00.000Z";

function memoryHarness(): Harness {
  const mem = new MemoryStore();
  return {
    store: new MemoryChainActionStore(mem, { challengeWindowSeconds: WINDOW_SECONDS }),
    contracts: new MemoryContractRepository(mem),
    seed: async (record) => {
      mem.findings.set(record.id, structuredClone(record));
    },
    finding: async (id) => {
      const r = mem.findings.get(id)!;
      return { status: r.status, history: r.statusHistory.length, window: r.challengeWindowExpiresAt };
    },
  };
}

function pgHarness(): Harness {
  const db = pool as Pool;
  const repo = new PgContractRepository(db);
  const pipeline = new PgPipelineRepository(db);
  return {
    store: new PgChainActionStore(db, { challengeWindowSeconds: WINDOW_SECONDS }),
    contracts: {
      ...repo,
      insertContract: async (record) => {
        createdContracts.push(record.contract.id);
        await repo.insertContract(record);
      },
      findContractById: (id, now) => repo.findContractById(id, now),
    } as ContractRepository,
    seed: async (f) => {
      await db.query(
        `INSERT INTO findings (id, contract_id, severity, slither_detector, slither_confidence, raw_output,
           raw_output_reference, llm_explanation, explanation_source, status, status_history,
           is_false_positive, challenge_window_expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          f.id, f.contractId, f.severity, f.slitherDetector, f.slitherConfidence,
          JSON.stringify(f.rawOutput), f.rawOutputReference, f.llmExplanation, f.explanationSource,
          f.status, JSON.stringify(f.statusHistory), f.isFalsePositive, f.challengeWindowExpiresAt,
          f.createdAt,
        ],
      );
    },
    finding: async (id) => {
      const found = await pipeline.findFinding(id, new Date());
      return {
        status: found!.status,
        history: found!.statusHistory.length,
        window: found!.challengeWindowExpiresAt,
      };
    },
  };
}

for (const [name, make, skip] of [
  ["Memory", memoryHarness, false],
  ["Postgres", pgHarness, !pool],
] as const) {
  describe.skipIf(skip)(`${name} ChainActionStore status writes`, () => {
    const h = skip ? (undefined as unknown as Harness) : make();

    async function seeded(status: FindingStatus) {
      const record = makeContract();
      await h.contracts.insertContract(record);
      const finding = makeFinding(record.contract.id, {
        status,
        statusHistory: [{ status, changedAt: AT }],
      });
      await h.seed(finding);
      return { contractId: record.contract.id, findingId: finding.id };
    }

    it("Verified sets the challenge window from the change time", async () => {
      const { findingId } = await seeded("Submitted");
      await h.store.setFindingStatus(findingId, "Verified", AT);
      const f = await h.finding(findingId);
      expect(f.status).toBe("Verified");
      expect(f.window).toBe(new Date(Date.parse(AT) + WINDOW_SECONDS * 1000).toISOString());
    });

    it("Disputed to Verified opens a new challenge window", async () => {
      const { findingId } = await seeded("Disputed");
      const later = "2026-10-20T13:00:00.000Z";
      await h.store.setFindingStatus(findingId, "Verified", later);
      expect((await h.finding(findingId)).window).toBe(
        new Date(Date.parse(later) + WINDOW_SECONDS * 1000).toISOString(),
      );
    });

    it("writing Verified again leaves the window unchanged", async () => {
      const { findingId } = await seeded("Submitted");
      await h.store.setFindingStatus(findingId, "Verified", AT);
      await h.store.setFindingStatus(findingId, "Verified", "2026-10-20T15:00:00.000Z");
      expect((await h.finding(findingId)).window).toBe(
        new Date(Date.parse(AT) + WINDOW_SECONDS * 1000).toISOString(),
      );
    });

    it("Paid resolves the finding's contract", async () => {
      const { contractId, findingId } = await seeded("Verified");
      await h.store.setFindingStatus(findingId, "Paid", AT);
      expect((await h.finding(findingId)).status).toBe("Paid");
      expect((await h.contracts.findContractById(contractId))?.status).toBe("Resolved");
    });

    it("writing the current status again is a no-op", async () => {
      const { findingId } = await seeded("Verified");
      await h.store.setFindingStatus(findingId, "Disputed", AT);
      await h.store.setFindingStatus(findingId, "Disputed", AT);
      const f = await h.finding(findingId);
      expect(f.status).toBe("Disputed");
      expect(f.history).toBe(2);
    });

    it("an illegal move throws InvalidTransitionError and changes nothing", async () => {
      const { findingId } = await seeded("Paid");
      await expect(h.store.setFindingStatus(findingId, "Disputed", AT)).rejects.toBeInstanceOf(
        InvalidTransitionError,
      );
      expect((await h.finding(findingId)).status).toBe("Paid");
    });
  });
}
