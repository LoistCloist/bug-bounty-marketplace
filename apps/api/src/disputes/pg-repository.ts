import type { Pool } from "pg";
import type { Dispute, DisputeRuling } from "@bbm/shared";
import type { DisputeRepository } from "./repository.js";

interface DisputeRow {
  id: string;
  finding_id: string;
  developer_id: string;
  reason: string;
  opened_at: Date;
  challenge_window_expires_at: Date | null;
  ruling: DisputeRuling;
  ruled_at: Date | null;
  arbiter_id: string | null;
}

const COLUMNS =
  "id, finding_id, developer_id, reason, opened_at, challenge_window_expires_at, ruling, ruled_at, arbiter_id";

function toDispute(row: DisputeRow): Dispute {
  return {
    id: row.id,
    findingId: row.finding_id,
    developerId: row.developer_id,
    reason: row.reason,
    openedAt: row.opened_at.toISOString(),
    challengeWindowExpiresAt: (row.challenge_window_expires_at ?? row.opened_at).toISOString(),
    ruling: row.ruling,
    ruledAt: row.ruled_at?.toISOString() ?? null,
    arbiterId: row.arbiter_id,
  };
}

/** Postgres DisputeRepository over the `disputes` table (migration 0007). */
export class PgDisputeRepository implements DisputeRepository {
  constructor(private readonly pool: Pool) {}

  async create(d: Dispute & { contractId: string }): Promise<Dispute> {
    await this.pool.query(
      `INSERT INTO disputes (id, finding_id, contract_id, developer_id, reason, opened_at, challenge_window_expires_at, ruling)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending')
       ON CONFLICT (finding_id) DO NOTHING`,
      [d.id, d.findingId, d.contractId, d.developerId, d.reason, d.openedAt, d.challengeWindowExpiresAt],
    );
    return (await this.findByFinding(d.findingId))!;
  }

  async findById(id: string): Promise<Dispute | null> {
    const result = await this.pool.query<DisputeRow>(`SELECT ${COLUMNS} FROM disputes WHERE id = $1`, [id]);
    return result.rows[0] ? toDispute(result.rows[0]) : null;
  }

  async findByFinding(findingId: string): Promise<Dispute | null> {
    const result = await this.pool.query<DisputeRow>(`SELECT ${COLUMNS} FROM disputes WHERE finding_id = $1`, [findingId]);
    return result.rows[0] ? toDispute(result.rows[0]) : null;
  }

  async list(ruling?: DisputeRuling): Promise<Dispute[]> {
    const result = await this.pool.query<DisputeRow>(
      `SELECT ${COLUMNS} FROM disputes WHERE ($1::text IS NULL OR ruling = $1) ORDER BY opened_at DESC`,
      [ruling ?? null],
    );
    return result.rows.map(toDispute);
  }

  async setRuling(id: string, ruling: Exclude<DisputeRuling, "Pending">, arbiterId: string, at: Date): Promise<Dispute | null> {
    const result = await this.pool.query<DisputeRow>(
      `UPDATE disputes SET ruling = $2, arbiter_id = $3, ruled_at = $4
        WHERE id = $1 AND ruling = 'Pending' RETURNING ${COLUMNS}`,
      [id, ruling, arbiterId, at],
    );
    return result.rows[0] ? toDispute(result.rows[0]) : null;
  }
}
