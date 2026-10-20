import { describe, expect, it } from "vitest";
import { ethToWei, weiToEth } from "./money";

describe("ethToWei", () => {
  it("converts whole and fractional ETH exactly", () => {
    expect(ethToWei("1")).toBe("1000000000000000000");
    expect(ethToWei("0.25")).toBe("250000000000000000");
    expect(ethToWei("0.000000000000000001")).toBe("1");
  });

  it("rejects more than 18 decimals, negatives and non-numeric input", () => {
    expect(() => ethToWei("0.0000000000000000001")).toThrow();
    expect(() => ethToWei("-1")).toThrow();
    expect(() => ethToWei("abc")).toThrow();
  });
});

describe("weiToEth", () => {
  it("formats wei as ETH without trailing zeros", () => {
    expect(weiToEth("1000000000000000000")).toBe("1");
    expect(weiToEth("250000000000000000")).toBe("0.25");
    expect(weiToEth("0")).toBe("0");
  });

  it("round-trips with ethToWei", () => {
    expect(weiToEth(ethToWei("12.345"))).toBe("12.345");
  });
});
