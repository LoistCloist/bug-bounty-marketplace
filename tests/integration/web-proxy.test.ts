import { ContractSchema } from "@bbm/shared";
import { describe, expect, it } from "vitest";
import { env } from "../lib/env.js";
import { getJson, postForm } from "../lib/http.js";
import { contractForm, validFields } from "./support.js";

describe("web: Next.js server and /api proxy", () => {
  it("GET /healthz answers { status: ok }", async () => {
    const { status, body } = await getJson<never>(`${env.webUrl}/healthz`);
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("GET / serves the HTML shell", async () => {
    const res = await fetch(`${env.webUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toMatch(/<html/i);
  });

  it("forwards a multipart upload to the API: created via web, readable via api", async () => {
    const fields = validFields();
    const created = await postForm(
      `${env.webUrl}/api/contracts`,
      contractForm(fields),
      ContractSchema,
    );
    expect(created.status).toBe(201);
    expect(created.body.developerAddress).toBe(fields.developerAddress);

    // Reading straight from the API proves the web server proxied the write
    // (rather than answering from MSW mocks or a local handler).
    const direct = await getJson(`${env.apiUrl}/api/contracts/${created.body.id}`, ContractSchema);
    expect(direct.status).toBe(200);
    expect(direct.body).toEqual(created.body);
  });

  it("proxies GET /api/contracts/:id, including the 404 body", async () => {
    const { status, body } = await getJson<never>(
      `${env.webUrl}/api/contracts/contract_missing-${Date.now()}`,
    );
    expect(status).toBe(404);
    expect(body).toEqual({ error: "Not found" });
  });
});
