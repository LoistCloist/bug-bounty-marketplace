import { z } from "zod";
import { AddressSchema, IdSchema, TimestampSchema } from "./common";
import { PositiveWeiSchema } from "./wei";

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

/** Upper bound on an uploaded .sol source, in bytes. The web form and the API
 * both enforce it; keep them in sync through this constant. */
export const CONTRACT_SOURCE_MAX_BYTES = 102_400; // 100 KB

/** Only Solidity source files are accepted for submission. */
export const ContractSourceFilenameSchema = z
  .string()
  .min(1)
  .regex(/\.sol$/i, { error: "Filename must end in .sol" });

/** Size check for an uploaded source file, applied to its byte length. */
export const ContractSourceSizeSchema = z
  .number()
  .int()
  .min(1, { error: "Source file must not be empty" })
  .max(CONTRACT_SOURCE_MAX_BYTES, { error: "Source file exceeds the 100 KB limit" });

/** Non-file fields of `POST /api/contracts`. Multipart values arrive as
 * strings; `bountyAmount` is wei as a decimal string. */
export const ContractSubmissionFieldsSchema = z.object({
  developerAddress: AddressSchema,
  bountyAmount: PositiveWeiSchema,
  currency: z.string().min(1).default("ETH"),
  deadline: TimestampSchema,
});
export type ContractSubmissionFields = z.infer<typeof ContractSubmissionFieldsSchema>;

export const ContractSchema = z.object({
  id: IdSchema,
  developerAddress: AddressSchema,
  filename: z.string().min(1),
  /** sha256 hex digest of the submitted Solidity source bytes, used to verify
   * integrity rather than storing the full source inline here. */
  sourceHash: z.string().min(1),
  /** Storage key of the source in the object store
   * (`contracts/<contractId>/<sourceHash>.sol`). */
  sourceReference: z.string().min(1),
  bountyId: IdSchema,
  status: ContractStatusSchema,
  createdAt: TimestampSchema,
  deadline: TimestampSchema,
});
export type Contract = z.infer<typeof ContractSchema>;
