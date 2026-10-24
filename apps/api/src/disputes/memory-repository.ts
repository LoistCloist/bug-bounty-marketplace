import type { Dispute, DisputeRuling } from "@bbm/shared";
import type { DisputeRepository } from "./repository.js";

export class MemoryDisputeRepository implements DisputeRepository {
  private readonly byId = new Map<string, Dispute>();

  async create(dispute: Dispute & { contractId: string }): Promise<Dispute> {
    const existing = await this.findByFinding(dispute.findingId);
    if (existing) return existing;
    const { contractId: _contractId, ...stored } = dispute;
    this.byId.set(stored.id, stored);
    return { ...stored };
  }

  async findById(id: string): Promise<Dispute | null> {
    const found = this.byId.get(id);
    return found ? { ...found } : null;
  }

  async findByFinding(findingId: string): Promise<Dispute | null> {
    for (const d of this.byId.values()) if (d.findingId === findingId) return { ...d };
    return null;
  }

  async list(ruling?: DisputeRuling): Promise<Dispute[]> {
    return [...this.byId.values()]
      .filter((d) => !ruling || d.ruling === ruling)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .map((d) => ({ ...d }));
  }

  async setRuling(id: string, ruling: Exclude<DisputeRuling, "Pending">, arbiterId: string, at: Date): Promise<Dispute | null> {
    const d = this.byId.get(id);
    if (!d || d.ruling !== "Pending") return null;
    const ruled = { ...d, ruling, arbiterId, ruledAt: at.toISOString() };
    this.byId.set(id, ruled);
    return { ...ruled };
  }
}
