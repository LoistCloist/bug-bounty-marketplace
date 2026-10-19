import type { Contract } from "@bbm/shared";
import type { ContractRepository, NewContractRecord } from "./repository.js";

/** Process-local repository used by tests and by the API when no DATABASE_URL
 * is configured. Data does not survive a restart. */
export class MemoryContractRepository implements ContractRepository {
  private readonly contracts = new Map<string, Contract>();
  private readonly bounties = new Map<string, NewContractRecord["bounty"]>();

  async insertContract({ contract, bounty }: NewContractRecord): Promise<void> {
    if (this.contracts.has(contract.id)) {
      throw new Error(`Contract ${contract.id} already exists`);
    }
    this.contracts.set(contract.id, { ...contract });
    this.bounties.set(bounty.id, { ...bounty });
  }

  async findContractById(id: string): Promise<Contract | null> {
    const contract = this.contracts.get(id);
    return contract ? { ...contract } : null;
  }
}
