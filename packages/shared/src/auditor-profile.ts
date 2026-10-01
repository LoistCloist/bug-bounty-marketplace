import { z } from "zod";
import { AddressSchema, IdSchema } from "./common.js";

export const AuditorProfileSchema = z.object({
  id: IdSchema,
  address: AddressSchema,
  /** Amount currently staked in escrow, slashable on a losing dispute ruling. */
  stake: z.number().nonnegative(),
  /** Simple numeric reputation score; higher is better. */
  reputation: z.number(),
  claimedContractIds: z.array(IdSchema).default([]),
});
export type AuditorProfile = z.infer<typeof AuditorProfileSchema>;
