import type { FindingStatus, FindingStatusHistoryEntry } from "@bbm/shared";
import type { FindingStatusReader, FindingStatusWriter } from "./finding-writer.js";

/** In-memory finding status store for tests and the MSW-style local setups. */
export class MemoryFindingStatusStore implements FindingStatusReader, FindingStatusWriter {
  private readonly findings = new Map<
    string,
    { status: FindingStatus; history: FindingStatusHistoryEntry[] }
  >();

  /** Registers a finding with its starting status and an initial history entry. */
  add(findingId: string, status: FindingStatus, changedAt: string): void {
    this.findings.set(findingId, { status, history: [{ status, changedAt }] });
  }

  async getFindingStatus(findingId: string): Promise<FindingStatus | null> {
    return this.findings.get(findingId)?.status ?? null;
  }

  async setFindingStatus(
    findingId: string,
    status: FindingStatus,
    changedAt: string,
  ): Promise<void> {
    const finding = this.findings.get(findingId);
    if (!finding) throw new Error(`Finding not found: ${findingId}`);
    finding.status = status;
    finding.history.push({ status, changedAt });
  }

  history(findingId: string): FindingStatusHistoryEntry[] {
    return [...(this.findings.get(findingId)?.history ?? [])];
  }
}
