import { z } from "zod";

/**
 * A non-negative amount of wei (1 ETH = 10^18 wei), sent as a decimal string.
 * Money is never a JS number: numbers lose precision above 2^53, and the
 * contracts store uint256 values. Up to 78 digits covers the full uint256
 * range. Leading zeros are rejected so each amount has one canonical form.
 */
export const WeiSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,77})$/, { error: "Must be a decimal wei amount with no leading zeros" });
export type Wei = z.infer<typeof WeiSchema>;

/** A wei amount that must be greater than zero (bounties, stake deposits). */
export const PositiveWeiSchema = WeiSchema.refine((value) => value !== "0", {
  error: "Must be greater than zero",
});

/** Orders two wei amounts exactly. Use this instead of subtracting strings or
 * numbers, which would lose precision above 2^53. */
export function compareWei(a: Wei, b: Wei): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x === y ? 0 : x > y ? 1 : -1;
}
