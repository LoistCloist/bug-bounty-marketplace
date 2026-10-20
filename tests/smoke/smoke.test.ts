import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ContractSchema } from "@bbm/shared";
import { env } from "../lib/env.js";
import { getJson, postForm } from "../lib/http.js";

/**
 * Post-deploy smoke checks. Safe to point at ANY environment (compose, the
 * ACA pipeline-test env, a PR preview, staging, prod) via BBM_API_URL /
 * BBM_WEB_URL. Whole suite should finish in well under 10s.
 *
 *   BBM_SMOKE_READONLY=1  skip the create+read round-trip (prod)
 *   BBM_SKIP_ANALYSIS=1   skip analysis /health (internal-only on ACA/AKS)
 */
const readonly = process.env.BBM_SMOKE_READONLY === "1";
const skipAnalysis = process.env.BBM_SKIP_ANALYSIS === "1";

// Per-request budget: a smoke check that needs longer than this is a failure.
const TIMEOUT_MS = 5_000;
const fetchT = (url: string, init?: RequestInit) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

const SAMPLE_SOL = readFileSync(new URL("../fixtures/Sample.sol", import.meta.url));

describe("smoke", { timeout: 10_000 }, () => {
  it("api /health is ok", async () => {
    const res = await fetchT(`${env.apiUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("web /healthz is ok", async () => {
    const res = await fetchT(`${env.webUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("web / serves the HTML shell", async () => {
    const res = await fetchT(`${env.webUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("Bug Bounty Marketplace");
  });

  it.skipIf(readonly)("create + read a contract through the web /api proxy", async () => {
    const form = new FormData();
    form.append("file", new Blob([SAMPLE_SOL], { type: "text/plain" }), "Sample.sol");
    form.append("developerAddress", "0x000000000000000000000000000000000000dEaD");
    form.append("bountyAmount", "0.01");
    form.append("currency", "ETH");
    form.append("deadline", new Date(Date.now() + 7 * 86_400_000).toISOString());

    const created = await postForm(`${env.webUrl}/api/contracts`, form, ContractSchema);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.filename).toBe("Sample.sol");

    const read = await getJson(
      `${env.webUrl}/api/contracts/${encodeURIComponent(created.body.id)}`,
      ContractSchema,
    );
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);
  });

  it.skipIf(skipAnalysis)("analysis /health is ok", async () => {
    const res = await fetchT(`${env.analysisUrl}/health`);
    expect(res.status).toBe(200);
  });
});
