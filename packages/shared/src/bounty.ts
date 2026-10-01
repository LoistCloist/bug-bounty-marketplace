import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common";

/**
 * Escrowed bounty funds for a contract. Kept deliberately simple (a numeric
 * amount + currency code) rather than modeling real on-chain token
 * mechanics - that detail belongs to the contracts/ workspace, not this
 * API-contract package.
 */
export const BountySchema = z.object({
  id: IdSchema,
  contractId: IdSchema,
  amount: z.number().positive(),
  currency: z.string().min(1),
  fundedAt: TimestampSchema,
  deadline: TimestampSchema,
});
export type Bounty = z.infer<typeof BountySchema>;
