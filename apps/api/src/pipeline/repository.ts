import type {
  AnalysisStatus,
  Contract,
  Finding,
  FindingSeverity,
  FindingStatus,
  FindingStatusHistoryEntry,
  PoCSubmission,
  SandboxStatus,
} from "@bbm/shared";

export type JobKind = "analysis" | "sandbox";
export type JobStatus = "queued" | "running" | "done" | "failed";

/** A job the API hands to the Python worker. Rows start as `queued`. */
export interface NewJob {
  id: string;
  kind: JobKind;
  /** Contract id for analysis jobs, PoC id for sandbox jobs. */
  subjectId: string;
  createdAt: string;
}

/** A finding as stored. The worker writes these; the API maps them onto the
 * shared `Finding` schema, adding the contract's active claim. */
export interface FindingRecord {
  id: string;
  contractId: string;
  severity: FindingSeverity;
  slitherDetector: string;
  slitherConfidence: string;
  rawOutput: unknown;
  rawOutputReference: string;
  llmExplanation: string;
  explanationSource: "llm" | "slither";
  status: FindingStatus;
  statusHistory: FindingStatusHistoryEntry[];
  isFalsePositive: boolean;
  challengeWindowExpiresAt: string | null;
  createdAt: string;
}

export interface NewPocRecord {
  poc: PoCSubmission;
  job: NewJob;
  findingId: string;
  /** ISO timestamp recorded in the finding's status history. */
  now: string;
}

/** Findings, PoC submissions and job status. Contract rows (and claims) live
 * in ContractRepository. */
export interface PipelineRepository {
  /** Ordered Critical → Informational, then oldest first. */
  listFindings(contractId: string, now: Date): Promise<Finding[]>;
  findFinding(id: string, now: Date): Promise<(Finding & { contract: Contract }) | null>;
  /** The finding's raw Slither detector entry, or null if the finding is unknown. */
  getRawOutput(findingId: string): Promise<unknown | null>;
  /** Status of the contract's latest analysis job, or null if it has none. */
  getAnalysisStatus(contractId: string): Promise<AnalysisStatus | null>;
  /** Moves a Flagged finding to Submitted and queues its PoC for the sandbox,
   * atomically, if `poc.auditorId` still holds the contract's claim at `now`.
   * Otherwise writes nothing and returns "no_claim" (claim missing, expired
   * or someone else's) or "not_flagged" (finding no longer Flagged). */
  submitPoc(record: NewPocRecord): Promise<"ok" | "not_flagged" | "no_claim">;
  /** Stores a sandbox verdict on a submitted PoC. Throws if the PoC is unknown. */
  recordVerdict(pocId: string, sandboxStatus: SandboxStatus): Promise<void>;
}
