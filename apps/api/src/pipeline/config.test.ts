import { describe, expect, it } from "vitest";
import { loadPipelineConfig } from "./config.js";

describe("loadPipelineConfig", () => {
  it("defaults the claim window to 600 seconds", () => {
    expect(loadPipelineConfig({}).claimWindowSeconds).toBe(600);
  });

  it("reads a positive integer", () => {
    expect(loadPipelineConfig({ CLAIM_WINDOW_SECONDS: "120" }).claimWindowSeconds).toBe(120);
  });

  it.each(["", "  ", "0", "-5", "1.5", "abc"])(
    "falls back to the default for %j, like the other API env vars",
    (value) => {
      expect(loadPipelineConfig({ CLAIM_WINDOW_SECONDS: value }).claimWindowSeconds).toBe(600);
    },
  );
});
