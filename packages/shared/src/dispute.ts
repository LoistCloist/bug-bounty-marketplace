import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";

export const DisputeRulingSchema = z.enum(["Pending", "ForAuditor", "AgainstAuditor"]);
export type DisputeRuling = z.infer<typeof DisputeRulingSchema>;

export const DisputeSchema = z.object({
  id: IdSchema,
  findingId: IdSchema,
  developerId: IdSchema,
  reason: z.string().min(1),
  openedAt: TimestampSchema,
  challengeWindowExpiresAt: TimestampSchema,
  ruling: DisputeRulingSchema,
  /** Set once an admin arbiter rules; null while ruling is Pending. */
  ruledAt: TimestampSchema.nullable().default(null),
  arbiterId: IdSchema.nullable().default(null),
});
export type Dispute = z.infer<typeof DisputeSchema>;
