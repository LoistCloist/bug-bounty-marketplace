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
