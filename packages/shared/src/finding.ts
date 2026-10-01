import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";

/**
 * - Flagged: raised by Slither + explained by the LLM, not yet claimed.
 * - Submitted: an auditor has claimed the contract and submitted a PoC
 *   against this finding; awaiting sandbox re-run.
 * - Verified: the sandbox successfully reproduced the PoC.
 * - Disputed: the developer opened a dispute during the challenge window.
 * - Rejected: sandbox failed to reproduce, or an auditor marked it a false
 *   positive, or a dispute ruled against the auditor.
 * - Paid: challenge window passed undisputed (or dispute ruled for the
 *   auditor) and escrow paid out.
 */
export const FindingStatusSchema = z.enum([
  "Flagged",
  "Submitted",
  "Verified",
  "Disputed",
  "Rejected",
  "Paid",
]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FindingSeveritySchema = z.enum([
  "Critical",
  "High",
  "Medium",
  "Low",
  "Informational",
]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingStatusHistoryEntrySchema = z.object({
  status: FindingStatusSchema,
  changedAt: TimestampSchema,
});
export type FindingStatusHistoryEntry = z.infer<typeof FindingStatusHistoryEntrySchema>;

export const FindingSchema = z.object({
  id: IdSchema,
  contractId: IdSchema,
  severity: FindingSeveritySchema,
  /** Slither detector id, e.g. "reentrancy-eth". */
  slitherDetector: z.string().min(1),
  /** Reference to the raw Slither output for this finding (storage key or URI). */
  rawOutputReference: z.string().min(1),
  /** Plain-English explanation from the LLM. Advisory only - never affects
   * status or payout. */
  llmExplanation: z.string().min(1),
  status: FindingStatusSchema,
  statusHistory: z.array(FindingStatusHistoryEntrySchema).default([]),
  /** Set while an auditor holds the exclusive claim on this finding's
   * contract; both null together outside of a claim window. */
  claimedByAuditorId: IdSchema.nullable().default(null),
  claimExpiresAt: TimestampSchema.nullable().default(null),
  /** Set by an auditor who reviewed the AI finding and judged it bogus. */
  isFalsePositive: z.boolean().default(false),
  /** Set when the finding becomes Verified; null otherwise. The developer
   * may dispute until this passes, after which escrow pays out if the
   * finding is still Verified (no dispute opened). */
  challengeWindowExpiresAt: TimestampSchema.nullable().default(null),
});
export type Finding = z.infer<typeof FindingSchema>;
