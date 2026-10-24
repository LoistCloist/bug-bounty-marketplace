import { z } from "zod";
import { AddressSchema } from "./common";
import { WeiSchema } from "./wei";

/** GET /api/chain: whether the API has a chain, and what the browser needs to
 * talk to it (RPC URL, contract addresses, demo constants). */
export const ChainInfoSchema = z.discriminatedUnion("configured", [
  z.object({ configured: z.literal(false) }),
  z.object({
    configured: z.literal(true),
    chainId: z.number().int().positive(),
    /** RPC URL reachable from the browser (not the API's internal one).
     * Absent when the API has no public URL configured; the browser then
     * cannot sign transactions itself. */
    rpcUrl: z.string().url().optional(),
    addresses: z.object({
      auditorStaking: AddressSchema,
      bountyEscrow: AddressSchema,
      disputeResolution: AddressSchema,
    }),
    arbiter: AddressSchema,
    challengeWindowSeconds: z.number().int().nonnegative(),
    requiredStakeWei: WeiSchema,
  }),
]);
export type ChainInfo = z.infer<typeof ChainInfoSchema>;
