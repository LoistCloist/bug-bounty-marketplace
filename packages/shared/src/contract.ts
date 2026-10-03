import { z } from "zod";
import { AddressSchema, IdSchema, TimestampSchema } from "./common";

/**
 * Lifecycle of a submitted contract:
 * - Open: funded, awaiting an auditor claim.
 * - Claimed: an auditor currently holds the exclusive, time-limited claim.
 * - Resolved: a finding was verified and escrow paid out (or no findings
 *   survived the challenge window and the bounty closed with no payout).
 * - Expired: the bounty deadline passed with no payout.
 */
export const ContractStatusSchema = z.enum(["Open", "Claimed", "Resolved", "Expired"]);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

export const ContractSchema = z.object({
  id: IdSchema,
  developerAddress: AddressSchema,
  filename: z.string().min(1),
  /** keccak256 (or similar) hash of the submitted Solidity source, used to
   * verify integrity rather than storing the full source inline here. */
  sourceHash: z.string().min(1),
  /** Where the full source lives (e.g. object storage key or URI). */
  sourceReference: z.string().min(1),
  bountyId: IdSchema,
  status: ContractStatusSchema,
  createdAt: TimestampSchema,
  deadline: TimestampSchema,
});
export type Contract = z.infer<typeof ContractSchema>;
