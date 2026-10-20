import { Pool } from "pg";
import { beforeAll } from "vitest";
import type { ContractRepository } from "../contracts/repository.js";
import { PgContractRepository } from "../contracts/pg-repository.js";
import { runMigrations } from "../db/migrate.js";
import { describeRepositories } from "../testing/repository-suite.js";
import type { JobStatus } from "./repository.js";
import { PgPipelineRepository } from "./pg-repository.js";

// Runs only when a Postgres instance is configured, e.g.
// DATABASE_URL=postgres://bbm:bbm@localhost:5432/bbm pnpm --filter @bbm/api test
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;

beforeAll(async () => {
  if (pool) await runMigrations(pool);
});

describeRepositories(
  "Postgres",
  () => {
    const db = pool as Pool;
    const repo = new PgContractRepository(db);
    const created: string[] = [];
    // Record every contract the tests insert so close() can remove them, keeping
    // a shared dev database free of test rows.
    const contracts: ContractRepository = {
      insertContract: async (record) => {
        created.push(record.contract.id);
        await repo.insertContract(record);
      },
      findContractById: (id, now) => repo.findContractById(id, now),
      listContracts: (filter, now) => repo.listContracts(filter, now),
      claimContract: (...args) => repo.claimContract(...args),
      listQueue: (now) => repo.listQueue(now),
      findActiveClaim: (id, now) => repo.findActiveClaim(id, now),
    };
    return {
      contracts,
      pipeline: new PgPipelineRepository(db),
      seedFinding: async (f) => {
        await db.query(
          `INSERT INTO findings (id, contract_id, severity, slither_detector, slither_confidence, raw_output,
             raw_output_reference, llm_explanation, explanation_source, status, status_history,
             is_false_positive, challenge_window_expires_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            f.id,
            f.contractId,
            f.severity,
            f.slitherDetector,
            f.slitherConfidence,
            JSON.stringify(f.rawOutput),
            f.rawOutputReference,
            f.llmExplanation,
            f.explanationSource,
            f.status,
            JSON.stringify(f.statusHistory),
            f.isFalsePositive,
            f.challengeWindowExpiresAt,
            f.createdAt,
          ],
        );
      },
      setJobStatus: async (jobId: string, status: JobStatus, lastError?: string) => {
        await db.query("UPDATE jobs SET status = $2, last_error = $3 WHERE id = $1", [
          jobId,
          status,
          lastError ?? null,
        ]);
      },
      jobsFor: async (subjectId) => {
        const result = await db.query<{ kind: string; status: JobStatus }>(
          "SELECT kind, status FROM jobs WHERE subject_id = $1 ORDER BY created_at",
          [subjectId],
        );
        return result.rows;
      },
      close: async () => {
        await db.query(
          `DELETE FROM jobs WHERE subject_id = ANY($1)
              OR subject_id IN (SELECT p.id FROM poc_submissions p JOIN findings f ON f.id = p.finding_id
                                 WHERE f.contract_id = ANY($1))`,
          [created],
        );
        await db.query(
          "DELETE FROM poc_submissions WHERE finding_id IN (SELECT id FROM findings WHERE contract_id = ANY($1))",
          [created],
        );
        await db.query("DELETE FROM findings WHERE contract_id = ANY($1)", [created]);
        await db.query("DELETE FROM contracts WHERE id = ANY($1)", [created]);
        await db.query("DELETE FROM bounties WHERE contract_id = ANY($1)", [created]);
        await db.end();
      },
    };
  },
  { concurrent: true, skip: !pool },
);
