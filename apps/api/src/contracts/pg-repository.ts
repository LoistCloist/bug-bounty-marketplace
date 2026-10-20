import type { Pool } from "pg";
import type { Contract, ContractStatus } from "@bbm/shared";
import type {
  ActiveClaim,
  ClaimResult,
  ContractRepository,
  NewContractRecord,
  QueueItem,
} from "./repository.js";

interface ContractRow {
  id: string;
  developer_address: string;
  filename: string;
  source_hash: string;
  source_reference: string;
  bounty_id: string;
  status: ContractStatus;
  created_at: Date;
  deadline: Date;
}

/** Columns for a contract as callers see it at time $N: a claim whose expiry
 * has passed reads back as Open. */
function contractColumns(nowParam: string): string {
  return `c.id, c.developer_address, c.filename, c.source_hash, c.source_reference, c.bounty_id,
          CASE WHEN c.status = 'Claimed' AND c.claim_expires_at <= ${nowParam} THEN 'Open'
               ELSE c.status END AS status,
          c.created_at, c.deadline`;
}

function toContract(row: ContractRow): Contract {
  return {
    id: row.id,
    developerAddress: row.developer_address,
    filename: row.filename,
    sourceHash: row.source_hash,
    sourceReference: row.source_reference,
    bountyId: row.bounty_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    deadline: row.deadline.toISOString(),
  };
}

/** PostgreSQL-backed repository. Schema lives in db/migrations. */
export class PgContractRepository implements ContractRepository {
  constructor(private readonly pool: Pool) {}

  async insertContract({ contract, bounty, analysisJob }: NewContractRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO bounties (id, contract_id, amount, currency, funded_at, deadline)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          bounty.id,
          bounty.contractId,
          bounty.amount,
          bounty.currency,
          bounty.fundedAt,
          bounty.deadline,
        ],
      );
      await client.query(
        `INSERT INTO contracts
           (id, developer_address, filename, source_hash, source_reference, bounty_id, status, created_at, deadline)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          contract.id,
          contract.developerAddress,
          contract.filename,
          contract.sourceHash,
          contract.sourceReference,
          contract.bountyId,
          contract.status,
          contract.createdAt,
          contract.deadline,
        ],
      );
      await client.query(
        `INSERT INTO jobs (id, kind, subject_id, status, attempts, created_at, updated_at)
         VALUES ($1, $2, $3, 'queued', 0, $4, $4)`,
        [analysisJob.id, analysisJob.kind, analysisJob.subjectId, analysisJob.createdAt],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async findContractById(id: string, now: Date = new Date()): Promise<Contract | null> {
    const result = await this.pool.query<ContractRow>(
      `SELECT ${contractColumns("$2")} FROM contracts c WHERE c.id = $1`,
      [id, now],
    );
    const row = result.rows[0];
    return row ? toContract(row) : null;
  }

  async listContracts(
    filter: { developerAddress?: string },
    now: Date = new Date(),
  ): Promise<Contract[]> {
    const result = await this.pool.query<ContractRow>(
      `SELECT ${contractColumns("$1")} FROM contracts c
        WHERE $2::text IS NULL OR lower(c.developer_address) = lower($2)
        ORDER BY c.created_at DESC, c.id`,
      [now, filter.developerAddress ?? null],
    );
    return result.rows.map(toContract);
  }

  async claimContract(
    contractId: string,
    auditorId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<ClaimResult> {
    // One UPDATE decides the race: Postgres re-checks the WHERE clause on the
    // locked row, so only one of two concurrent claims can match.
    const result = await this.pool.query<ContractRow>(
      `UPDATE contracts c
          SET status = 'Claimed', claimed_by_auditor_id = $2, claim_expires_at = $3,
              claim_lock_status = NULL
        WHERE c.id = $1
          AND (c.status = 'Open' OR (c.status = 'Claimed' AND c.claim_expires_at <= $4))
        RETURNING ${contractColumns("$4")}`,
      [contractId, auditorId, expiresAt, now],
    );
    const row = result.rows[0];
    if (row) return { ok: true, contract: toContract(row) };
    const exists = await this.pool.query("SELECT 1 FROM contracts WHERE id = $1", [contractId]);
    return { ok: false, reason: exists.rowCount ? "not_open" : "not_found" };
  }

  async releaseClaim(contractId: string, auditorId: string): Promise<void> {
    await this.pool.query(
      `UPDATE contracts
          SET status = 'Open', claimed_by_auditor_id = NULL, claim_expires_at = NULL,
              claim_lock_status = NULL
        WHERE id = $1 AND status = 'Claimed' AND claimed_by_auditor_id = $2`,
      [contractId, auditorId],
    );
  }

  async listQueue(now: Date): Promise<QueueItem[]> {
    const result = await this.pool.query<ContractRow & { amount: string; currency: string }>(
      `SELECT ${contractColumns("$1")}, b.amount, b.currency
         FROM contracts c JOIN bounties b ON b.id = c.bounty_id
        WHERE c.status = 'Open' OR (c.status = 'Claimed' AND c.claim_expires_at <= $1)`,
      [now],
    );
    return result.rows.map((row) => ({
      ...toContract(row),
      bounty: { amount: String(row.amount), currency: row.currency },
    }));
  }

  async findActiveClaim(contractId: string, now: Date): Promise<ActiveClaim | null> {
    const result = await this.pool.query<{ claimed_by_auditor_id: string; claim_expires_at: Date }>(
      `SELECT claimed_by_auditor_id, claim_expires_at FROM contracts
        WHERE id = $1 AND status = 'Claimed' AND claim_expires_at > $2`,
      [contractId, now],
    );
    const row = result.rows[0];
    return row ? { auditorId: row.claimed_by_auditor_id, expiresAt: row.claim_expires_at } : null;
  }
}
