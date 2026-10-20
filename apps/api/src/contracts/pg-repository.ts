import type { Pool } from "pg";
import type { Contract, ContractStatus } from "@bbm/shared";
import type { ContractRepository, NewContractRecord } from "./repository.js";

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

/** PostgreSQL-backed repository. Schema lives in db/migrations. */
export class PgContractRepository implements ContractRepository {
  constructor(private readonly pool: Pool) {}

  async insertContract({ contract, bounty }: NewContractRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO bounties (id, contract_id, amount, currency, funded_at, deadline)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bounty.id, bounty.contractId, bounty.amount, bounty.currency, bounty.fundedAt, bounty.deadline],
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
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async findContractById(id: string): Promise<Contract | null> {
    const result = await this.pool.query<ContractRow>(
      `SELECT id, developer_address, filename, source_hash, source_reference,
              bounty_id, status, created_at, deadline
         FROM contracts
        WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
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
}
