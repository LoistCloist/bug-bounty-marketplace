import type { Dispute, DisputeRuling } from "@bbm/shared";

/** Disputes mirrored from DisputeResolution: one per finding. */
export interface DisputeRepository {
  /** Inserts the dispute unless the finding already has one; returns the stored one. */
  create(dispute: Dispute & { contractId: string }): Promise<Dispute>;
  findById(id: string): Promise<Dispute | null>;
  findByFinding(findingId: string): Promise<Dispute | null>;
  list(ruling?: DisputeRuling): Promise<Dispute[]>;
  /** Sets the ruling of a Pending dispute; null when it was already ruled. */
  setRuling(id: string, ruling: Exclude<DisputeRuling, "Pending">, arbiterId: string, at: Date): Promise<Dispute | null>;
}
