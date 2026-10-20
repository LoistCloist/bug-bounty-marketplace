import { z } from "zod";

/** Largest value a uint256 can hold, the range the contracts store. */
export const UINT256_MAX = 2n ** 256n - 1n;

/**
 * A non-negative amount of wei (1 ETH = 10^18 wei), sent as a decimal string.
 * Money is never a JS number: numbers lose precision above 2^53. The pattern
 * allows up to 78 digits and rejects leading zeros, so each amount has one
 * canonical form. The uint256 bound is checked exactly in code, since a
 * pattern alone cannot express it.
 */
const WEI_FORMAT = /^(0|[1-9]\d{0,77})$/;
const POSITIVE_WEI_FORMAT = /^[1-9]\d{0,77}$/;
// Runs even after a format failure, so it must not throw on non-digit input.
const withinUint256 = (value: unknown) =>
  typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) <= UINT256_MAX;

export const WeiSchema = z
  .string()
  .regex(WEI_FORMAT, { error: "Must be a decimal wei amount with no leading zeros" })
  .refine(withinUint256, { error: "Exceeds the uint256 range" });
export type Wei = z.infer<typeof WeiSchema>;

/**
 * A wei amount greater than zero (bounties, stake deposits). Zero is excluded
 * by the pattern itself, so the generated JSON Schema and Python models reject
 * it too.
 */
export const PositiveWeiSchema = z
  .string()
  .regex(POSITIVE_WEI_FORMAT, { error: "Must be a positive decimal wei amount" })
  .refine(withinUint256, { error: "Exceeds the uint256 range" });

/** Orders two wei amounts exactly. Use this instead of subtracting strings or
 * numbers, which would lose precision above 2^53. */
export function compareWei(a: Wei, b: Wei): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x === y ? 0 : x > y ? 1 : -1;
}
