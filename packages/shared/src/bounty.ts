import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common";
import { PositiveWeiSchema } from "./wei";

/**
 * Escrowed bounty funds for a contract. `amount` is wei as a decimal string,
 * matching the on-chain uint256 the BountyEscrow contract stores.
 */
export const BountySchema = z.object({
  id: IdSchema,
  contractId: IdSchema,
  amount: PositiveWeiSchema,
  currency: z.string().min(1),
  fundedAt: TimestampSchema,
  deadline: TimestampSchema,
});
export type Bounty = z.infer<typeof BountySchema>;
