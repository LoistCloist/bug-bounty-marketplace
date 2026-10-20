import type { Pool } from "pg";
import type { AnalysisStatus, Contract, Finding } from "@bbm/shared";
import { PgContractRepository } from "../contracts/pg-repository.js";
import type { ActiveClaim } from "../contracts/repository.js";
import { compareFindings, toAnalysisJobStatus, toFinding } from "./mapping.js";
import type { FindingRecord, JobStatus, NewPocRecord, PipelineRepository } from "./repository.js";

interface FindingRow {
  id: string;
  contract_id: string;
  severity: FindingRecord["severity"];
  slither_detector: string;
  slither_confidence: string;
  raw_output_reference: string;
  llm_explanation: string;
  explanation_source: FindingRecord["explanationSource"];
  status: FindingRecord["status"];
  status_history: FindingRecord["statusHistory"];
  is_false_positive: boolean;
  challenge_window_expires_at: Date | null;
  created_at: Date;
}

const FINDING_COLUMNS = `id, contract_id, severity, slither_detector, slither_confidence,
  raw_output_reference, llm_explanation, explanation_source, status, status_history,
  is_false_positive, challenge_window_expires_at, created_at`;

/** Raw output is fetched separately (GET /api/findings/:id/raw), so list
 * queries leave the JSONB column out. */
function toRecord(row: FindingRow): FindingRecord {
  return {
    id: row.id,
    contractId: row.contract_id,
    severity: row.severity,
    slitherDetector: row.slither_detector,
    slitherConfidence: row.slither_confidence,
    rawOutput: null,
    rawOutputReference: row.raw_output_reference,
    llmExplanation: row.llm_explanation,
    explanationSource: row.explanation_source,
    status: row.status,
    statusHistory: row.status_history,
    isFalsePositive: row.is_false_positive,
    challengeWindowExpiresAt: row.challenge_window_expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export class PgPipelineRepository implements PipelineRepository {
  private readonly contracts: PgContractRepository;

  constructor(private readonly pool: Pool) {
    this.contracts = new PgContractRepository(pool);
  }

  async listFindings(contractId: string, now: Date): Promise<Finding[]> {
    const [result, claim] = await Promise.all([
      this.pool.query<FindingRow>(
        `SELECT ${FINDING_COLUMNS} FROM findings WHERE contract_id = $1`,
        [contractId],
      ),
      this.contracts.findActiveClaim(contractId, now),
    ]);
    return result.rows
      .map(toRecord)
      .sort(compareFindings)
      .map((record) => toFinding(record, claim));
  }

  async findFinding(id: string, now: Date): Promise<(Finding & { contract: Contract }) | null> {
    const result = await this.pool.query<FindingRow>(
      `SELECT ${FINDING_COLUMNS} FROM findings WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    const [contract, claim] = await Promise.all([
      this.contracts.findContractById(row.contract_id, now),
      this.contracts.findActiveClaim(row.contract_id, now),
    ]);
    if (!contract) return null;
    return { ...toFinding(toRecord(row), claim as ActiveClaim | null), contract };
  }

  async getRawOutput(findingId: string): Promise<unknown | null> {
    const result = await this.pool.query<{ raw_output: unknown }>(
      "SELECT raw_output FROM findings WHERE id = $1",
      [findingId],
    );
    return result.rows[0]?.raw_output ?? null;
  }

  async getAnalysisStatus(contractId: string): Promise<AnalysisStatus | null> {
    const result = await this.pool.query<{
      status: JobStatus;
      last_error: string | null;
      updated_at: Date;
      finding_count: string;
    }>(
      `SELECT j.status, j.last_error, j.updated_at,
              (SELECT count(*) FROM findings f WHERE f.contract_id = $1) AS finding_count
         FROM jobs j
        WHERE j.kind = 'analysis' AND j.subject_id = $1
        ORDER BY j.created_at DESC, j.id DESC
        LIMIT 1`,
      [contractId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      contractId,
      status: toAnalysisJobStatus(row.status),
      error: row.status === "failed" ? row.last_error : null,
      findingCount: Number(row.finding_count),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async submitPoc({ poc, job, findingId, now }: NewPocRecord): Promise<"ok" | "not_flagged"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE findings
            SET status = 'Submitted', status_history = status_history || $2::jsonb
          WHERE id = $1 AND status = 'Flagged'`,
        [findingId, JSON.stringify([{ status: "Submitted", changedAt: now }])],
      );
      if (updated.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "not_flagged";
      }
      await client.query(
        `INSERT INTO poc_submissions
           (id, finding_id, auditor_id, test_file_reference, submitted_at, sandbox_status, sandbox_log)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          poc.id,
          poc.findingId,
          poc.auditorId,
          poc.testFileReference,
          poc.submittedAt,
          poc.sandboxStatus,
          poc.sandboxLog,
        ],
      );
      await client.query(
        `INSERT INTO jobs (id, kind, subject_id, status, attempts, created_at, updated_at)
         VALUES ($1, $2, $3, 'queued', 0, $4, $4)`,
        [job.id, job.kind, job.subjectId, job.createdAt],
      );
      await client.query("COMMIT");
      return "ok";
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
