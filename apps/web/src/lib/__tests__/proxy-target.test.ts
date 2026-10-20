import { describe, expect, it } from "vitest";
import { buildProxyTarget } from "@/lib/proxy-target";

describe("buildProxyTarget", () => {
  it("returns null when the upstream is unset or blank", () => {
    expect(buildProxyTarget(undefined, "/api/contracts", "")).toBeNull();
    expect(buildProxyTarget("", "/api/contracts", "")).toBeNull();
    expect(buildProxyTarget("   ", "/api/contracts", "")).toBeNull();
  });

  it("joins origin and path", () => {
    expect(buildProxyTarget("http://api:3001", "/api/contracts/x", "")).toBe(
      "http://api:3001/api/contracts/x",
    );
  });

  it("strips trailing slashes from the origin", () => {
    expect(buildProxyTarget("http://api:3001/", "/api/contracts", "")).toBe(
      "http://api:3001/api/contracts",
    );
    expect(buildProxyTarget("http://api:3001///", "/api/contracts", "")).toBe(
      "http://api:3001/api/contracts",
    );
  });

  it("keeps a path prefix on the origin", () => {
    expect(buildProxyTarget("https://host/backend/", "/api/a", "")).toBe(
      "https://host/backend/api/a",
    );
  });

  it("preserves the query string", () => {
    expect(buildProxyTarget("http://api:3001", "/api/findings", "?status=Flagged&page=2")).toBe(
      "http://api:3001/api/findings?status=Flagged&page=2",
    );
    expect(buildProxyTarget("http://api:3001", "/api/findings", "status=Paid")).toBe(
      "http://api:3001/api/findings?status=Paid",
    );
  });

  it("drops an empty query string", () => {
    expect(buildProxyTarget("http://api:3001", "/api/findings", "?")).toBe(
      "http://api:3001/api/findings",
    );
  });
});
