import type { Bounty, Contract, Wei } from "@bbm/shared";
import type { NewJob } from "../pipeline/repository.js";

export interface NewContractRecord {
  contract: Contract;
  bounty: Bounty;
  /** Queued in the same transaction so every stored contract gets analysed. */
  analysisJob: NewJob;
}

export type QueueItem = Contract & { bounty: { amount: Wei; currency: string } };

export type ClaimResult =
  | { ok: true; contract: Contract }
  | { ok: false; reason: "not_found" | "not_open" | "auditor_has_claim" };

export interface ActiveClaim {
  auditorId: string;
  expiresAt: Date;
}

/** Persistence for contracts, their bounties and their claims. Routes and
 * services depend on this interface, so the Postgres and in-memory
 * implementations stay interchangeable.
 *
 * A claim whose expiry has passed is treated as gone: the contract reads back
 * as `Open` and can be claimed again. */
export interface ContractRepository {
  /** Inserts the contract, its bounty and its analysis job together. */
  insertContract(record: NewContractRecord): Promise<void>;
  findContractById(id: string, now?: Date): Promise<Contract | null>;
  /** Newest first, optionally only one developer's (address match ignores case). */
  listContracts(filter: { developerAddress?: string }, now?: Date): Promise<Contract[]>;
  /** Atomic: of two simultaneous claims, exactly one succeeds. An auditor may
   * hold one claim at a time: the claim is refused with "auditor_has_claim"
   * while the auditor has another active claim or a claim lock state. */
  claimContract(
    contractId: string,
    auditorId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<ClaimResult>;
  /** Rolls back a claim this auditor holds, reopening the contract. A no-op
   * when the auditor no longer holds it. Used when the on-chain lock fails. */
  releaseClaim(contractId: string, auditorId: string): Promise<void>;
  /** Contracts open to claim (including expired claims), with their bounty. */
  listQueue(now: Date): Promise<QueueItem[]>;
  findActiveClaim(contractId: string, now: Date): Promise<ActiveClaim | null>;
}
