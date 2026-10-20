import type { Pool } from "pg";
import type { AppliedEvent, AppliedEventKey, IndexerRepository } from "./repository.js";

/** Postgres indexer state; tables are created by 0004_indexer.sql. */
export class PgIndexerRepository implements IndexerRepository {
  constructor(private readonly pool: Pool) {}

  async getCheckpoint(chainId: number): Promise<bigint | null> {
    const { rows } = await this.pool.query<{ block_number: string }>(
      "SELECT block_number FROM indexer_checkpoints WHERE chain_id = $1",
      [chainId],
    );
    return rows[0] ? BigInt(rows[0].block_number) : null;
  }

  async setCheckpoint(chainId: number, blockNumber: bigint): Promise<void> {
    await this.pool.query(
      `INSERT INTO indexer_checkpoints (chain_id, block_number, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (chain_id) DO UPDATE
         SET block_number = EXCLUDED.block_number, updated_at = now()`,
      [chainId, blockNumber.toString()],
    );
  }

  async hasApplied(key: AppliedEventKey): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      "SELECT 1 FROM indexer_applied_events WHERE chain_id = $1 AND tx_hash = $2 AND log_index = $3",
      [key.chainId, key.txHash.toLowerCase(), key.logIndex],
    );
    return (rowCount ?? 0) > 0;
  }

  async markApplied(event: AppliedEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO indexer_applied_events (chain_id, tx_hash, log_index, event_name, applied_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
      [event.chainId, event.txHash.toLowerCase(), event.logIndex, event.eventName, event.appliedAt],
    );
  }
}
