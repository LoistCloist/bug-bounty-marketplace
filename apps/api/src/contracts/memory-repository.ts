import type { Contract } from "@bbm/shared";
import { MemoryStore } from "../pipeline/memory-repository.js";
import type {
  ActiveClaim,
  ClaimResult,
  ContractRepository,
  NewContractRecord,
  QueueItem,
} from "./repository.js";

/** Process-local repository used by tests and by the API when no DATABASE_URL
 * is configured. Data does not survive a restart. Pass the same MemoryStore
 * to MemoryPipelineRepository so both see the same rows. */
export class MemoryContractRepository implements ContractRepository {
  constructor(private readonly store: MemoryStore = new MemoryStore()) {}

  async insertContract({ contract, bounty, analysisJob }: NewContractRecord): Promise<void> {
    if (this.store.contracts.has(contract.id)) {
      throw new Error(`Contract ${contract.id} already exists`);
    }
    this.store.contracts.set(contract.id, {
      contract: { ...contract },
      claimedByAuditorId: null,
      claimExpiresAt: null,
    });
    this.store.bounties.set(bounty.id, { ...bounty });
    this.store.jobs.set(analysisJob.id, {
      ...analysisJob,
      status: "queued",
      attempts: 0,
      lastError: null,
      updatedAt: analysisJob.createdAt,
    });
  }

  async findContractById(id: string, now: Date = new Date()): Promise<Contract | null> {
    const stored = this.store.contracts.get(id);
    return stored ? this.store.view(stored, now) : null;
  }

  async listContracts(
    filter: { developerAddress?: string },
    now: Date = new Date(),
  ): Promise<Contract[]> {
    const wanted = filter.developerAddress?.toLowerCase();
    return [...this.store.contracts.values()]
      .filter((s) => !wanted || s.contract.developerAddress.toLowerCase() === wanted)
      .sort((a, b) => b.contract.createdAt.localeCompare(a.contract.createdAt))
      .map((s) => this.store.view(s, now));
  }

  async claimContract(
    contractId: string,
    auditorId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<ClaimResult> {
    const stored = this.store.contracts.get(contractId);
    if (!stored) return { ok: false, reason: "not_found" };
    if (this.store.view(stored, now).status !== "Open") return { ok: false, reason: "not_open" };
    stored.contract.status = "Claimed";
    stored.claimedByAuditorId = auditorId;
    stored.claimExpiresAt = new Date(expiresAt);
    return { ok: true, contract: { ...stored.contract } };
  }

  async listQueue(now: Date): Promise<QueueItem[]> {
    const items: QueueItem[] = [];
    for (const stored of this.store.contracts.values()) {
      const contract = this.store.view(stored, now);
      if (contract.status !== "Open") continue;
      const bounty = this.store.bounties.get(contract.bountyId);
      items.push({
        ...contract,
        bounty: { amount: bounty?.amount ?? "0", currency: bounty?.currency ?? "ETH" },
      });
    }
    return items;
  }

  async findActiveClaim(contractId: string, now: Date): Promise<ActiveClaim | null> {
    return this.store.activeClaim(contractId, now);
  }
}
