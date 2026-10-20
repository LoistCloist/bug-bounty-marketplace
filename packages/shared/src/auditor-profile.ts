import { z } from "zod";
import { AddressSchema, IdSchema } from "./common";
import { WeiSchema } from "./wei";

export const AuditorProfileSchema = z.object({
  id: IdSchema,
  address: AddressSchema,
  /** Wei currently staked, slashable on a losing dispute ruling. */
  stake: WeiSchema,
  /** Simple numeric reputation score; higher is better. */
  reputation: z.number(),
  claimedContractIds: z.array(IdSchema).default([]),
});
export type AuditorProfile = z.infer<typeof AuditorProfileSchema>;
