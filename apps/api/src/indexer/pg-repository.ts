import type { Pool, PoolClient } from "pg";
import type { Address, Hex } from "viem";
import type {
  AppliedEvent,
  AppliedEventKey,
  IndexerLock,
  IndexerRepository,
  PendingEvent,
} from "./repository.js";

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

  /** Monotonic: the row only moves forward, so a stale writer cannot rewind it. */
  async setCheckpoint(chainId: number, blockNumber: bigint): Promise<void> {
    await this.pool.query(
      `INSERT INTO indexer_checkpoints (chain_id, block_number, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (chain_id) DO UPDATE
         SET block_number = EXCLUDED.block_number, updated_at = now()
         WHERE indexer_checkpoints.block_number < EXCLUDED.block_number`,
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

  async addPending(event: PendingEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO indexer_pending_events
         (chain_id, tx_hash, log_index, address, topics, data, block_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
      [
        event.chainId,
        event.txHash.toLowerCase(),
        event.logIndex,
        event.address.toLowerCase(),
        [...event.topics],
        event.data,
        event.blockNumber.toString(),
      ],
    );
  }

  async listPending(chainId: number): Promise<PendingEvent[]> {
    const { rows } = await this.pool.query<{
      chain_id: number;
      tx_hash: string;
      log_index: number;
      address: string;
      topics: string[];
      data: string;
      block_number: string;
    }>(
      `SELECT chain_id, tx_hash, log_index, address, topics, data, block_number
         FROM indexer_pending_events
        WHERE chain_id = $1
        ORDER BY block_number, log_index`,
      [chainId],
    );
    return rows.map((row) => ({
      chainId: row.chain_id,
      txHash: row.tx_hash,
      logIndex: row.log_index,
      address: row.address as Address,
      topics: row.topics as Hex[],
      data: row.data as Hex,
      blockNumber: BigInt(row.block_number),
    }));
  }

  async removePending(key: AppliedEventKey): Promise<void> {
    await this.pool.query(
      "DELETE FROM indexer_pending_events WHERE chain_id = $1 AND tx_hash = $2 AND log_index = $3",
      [key.chainId, key.txHash.toLowerCase(), key.logIndex],
    );
  }

  async prunePending(chainId: number, beforeBlock: bigint): Promise<number> {
    const { rowCount } = await this.pool.query(
      "DELETE FROM indexer_pending_events WHERE chain_id = $1 AND block_number < $2",
      [chainId, beforeBlock.toString()],
    );
    return rowCount ?? 0;
  }
}

/** Key for pg_try_advisory_lock. hashtext is stable for a given string. */
const LOCK_KEY_SQL = "hashtext('bbm_indexer')::bigint";

/**
 * Cross-replica lock on a session advisory lock. A session lock belongs to
 * the connection that took it, so the lock holds one pool client from acquire
 * to release and never runs its query on a pooled connection that could be
 * handed to someone else. Losing the connection drops the lock server-side.
 */
export class PgIndexerLock implements IndexerLock {
  private client: PoolClient | null = null;

  constructor(private readonly pool: Pool) {}

  async tryAcquire(): Promise<boolean> {
    if (this.client !== null) throw new Error("PgIndexerLock is already held by this instance");
    const client = await this.pool.connect();
    let locked: boolean;
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(${LOCK_KEY_SQL}) AS locked`,
      );
      locked = rows[0]?.locked === true;
    } catch (err) {
      client.release(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
    if (!locked) {
      client.release();
      return false;
    }
    this.client = client;
    return true;
  }

  async release(): Promise<void> {
    const client = this.client;
    if (client === null) return;
    this.client = null;
    try {
      await client.query(`SELECT pg_advisory_unlock(${LOCK_KEY_SQL})`);
    } catch (err) {
      // Destroy the connection instead of pooling it: closing the session frees the lock.
      client.release(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
    client.release();
  }
}

/** Every finding id, for the indexer's on-chain id lookup. */
export async function listFindingIds(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ id: string }>("SELECT id FROM findings");
  return result.rows.map((row) => row.id);
}
