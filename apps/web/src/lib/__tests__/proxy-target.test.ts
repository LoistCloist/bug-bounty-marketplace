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

  it("throws on an upstream that is not an absolute http(s) URL", () => {
    for (const bad of ["api:3001", "127.0.0.1:3993", "/backend", "ftp://api:3001"]) {
      expect(() => buildProxyTarget(bad, "/api/contracts", "")).toThrow(
        /API_INTERNAL_URL must be an absolute http\(s\) URL/,
      );
    }
  });

  it("accepts https and IP upstreams", () => {
    expect(buildProxyTarget("http://127.0.0.1:3993", "/api/a", "")).toBe(
      "http://127.0.0.1:3993/api/a",
    );
    expect(buildProxyTarget("https://api.example.com", "/api/a", "")).toBe(
      "https://api.example.com/api/a",
    );
  });
});
