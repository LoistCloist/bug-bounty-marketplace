import { describe, expect, it } from "vitest";
import { env } from "../lib/env.js";

// The analysis worker is always up in docker compose, but on Azure Container
// Apps it is optional and internal-only (not reachable from the runner), so
// the deploy workflow sets BBM_SKIP_ANALYSIS=1.
const skip = process.env.BBM_SKIP_ANALYSIS === "1";

describe.skipIf(skip)("analysis worker", () => {
  it("GET /health answers { status: ok }", async () => {
    const res = await fetch(`${env.analysisUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("POST /analyze is still a 501 stub", async () => {
    const res = await fetch(`${env.analysisUrl}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contractId: "contract_it", source: "contract A {}" }),
    });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toMatch(/not implemented/);
  });

  it("POST /analyze validates its body (422 on missing fields)", async () => {
    const res = await fetch(`${env.analysisUrl}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });
});
