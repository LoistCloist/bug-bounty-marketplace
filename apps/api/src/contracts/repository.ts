import type { Bounty, Contract } from "@bbm/shared";

export interface NewContractRecord {
  contract: Contract;
  bounty: Bounty;
}

/** Persistence for contracts and their bounties. Routes and services depend
 * on this interface, so the Postgres and in-memory implementations stay
 * interchangeable. */
export interface ContractRepository {
  /** Inserts the contract and its bounty together. */
  insertContract(record: NewContractRecord): Promise<void>;
  findContractById(id: string): Promise<Contract | null>;
}
