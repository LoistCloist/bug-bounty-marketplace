import { describe, expect, it } from "vitest";
import { compareWei, PositiveWeiSchema, WeiSchema } from "../wei";

describe("WeiSchema", () => {
  it("accepts zero and canonical decimal strings", () => {
    expect(WeiSchema.safeParse("0").success).toBe(true);
    expect(WeiSchema.safeParse("1000000000000000000").success).toBe(true);
  });

  it("rejects leading zeros, signs, decimals and numbers", () => {
    expect(WeiSchema.safeParse("01").success).toBe(false);
    expect(WeiSchema.safeParse("-1").success).toBe(false);
    expect(WeiSchema.safeParse("1.5").success).toBe(false);
    expect(WeiSchema.safeParse(1).success).toBe(false);
  });

  it("rejects values wider than uint256", () => {
    expect(WeiSchema.safeParse("1".repeat(79)).success).toBe(false);
  });
});

describe("PositiveWeiSchema", () => {
  it("rejects zero", () => {
    expect(PositiveWeiSchema.safeParse("0").success).toBe(false);
    expect(PositiveWeiSchema.safeParse("1").success).toBe(true);
  });
});

describe("compareWei", () => {
  it("compares beyond the 2^53 range exactly", () => {
    const big = "9007199254740993";
    const bigger = "9007199254740994";
    expect(compareWei(big, bigger)).toBe(-1);
    expect(compareWei(bigger, big)).toBe(1);
    expect(compareWei(big, big)).toBe(0);
  });
});

describe("uint256 bound", () => {
  const MAX = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

  it("accepts the largest uint256 and rejects one more", () => {
    expect(WeiSchema.safeParse(MAX).success).toBe(true);
    expect(WeiSchema.safeParse((BigInt(MAX) + 1n).toString()).success).toBe(false);
  });

  it("rejects 78-digit values above the uint256 maximum", () => {
    expect(WeiSchema.safeParse("9".repeat(78)).success).toBe(false);
    expect(PositiveWeiSchema.safeParse("9".repeat(78)).success).toBe(false);
  });
});
