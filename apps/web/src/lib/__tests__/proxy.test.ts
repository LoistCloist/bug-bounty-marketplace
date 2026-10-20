import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

describe("proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("answers 500 JSON and logs once when API_INTERNAL_URL is malformed", async () => {
    vi.stubEnv("API_INTERNAL_URL", "api:3001");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const first = proxy(new NextRequest("http://web.local/api/contracts"));
    const second = proxy(new NextRequest("http://web.local/api/contracts"));

    expect(first.status).toBe(500);
    expect(await first.json()).toEqual({ error: "proxy misconfigured" });
    expect(second.status).toBe(500);
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("rewrites to the upstream when API_INTERNAL_URL is valid", () => {
    vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:3993");
    const res = proxy(new NextRequest("http://web.local/api/contracts?x=1"));
    expect(res.headers.get("x-middleware-rewrite")).toBe("http://127.0.0.1:3993/api/contracts?x=1");
  });
});
