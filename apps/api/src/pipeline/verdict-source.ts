import type { PoCSubmission, SandboxStatus } from "@bbm/shared";

/**
 * Where a PoC's sandbox verdict comes from. The real sandbox is a separate
 * worker that is not built yet; until it exists the API uses
 * NotConfiguredVerdictSource and submissions stay Pending.
 */
export interface PocVerdictSource {
  requestVerdict(submission: PoCSubmission): Promise<SandboxStatus>;
}

/** Production default until the sandbox worker is wired in. Never decides. */
export class NotConfiguredVerdictSource implements PocVerdictSource {
  async requestVerdict(): Promise<SandboxStatus> {
    return "Pending";
  }
}

/**
 * Deterministic test double. Returns the configured verdict for every request
 * and records what it was asked about. Change the verdict with `setVerdict`.
 * For unit tests and local demos only.
 */
export class FixedVerdictSource implements PocVerdictSource {
  readonly requested: PoCSubmission[] = [];

  constructor(private verdict: SandboxStatus = "Pending") {}

  setVerdict(verdict: SandboxStatus): void {
    this.verdict = verdict;
  }

  async requestVerdict(submission: PoCSubmission): Promise<SandboxStatus> {
    this.requested.push({ ...submission });
    return this.verdict;
  }
}
