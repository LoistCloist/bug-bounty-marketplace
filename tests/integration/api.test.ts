import { createHash } from "node:crypto";
import { CONTRACT_SOURCE_MAX_BYTES, ContractSchema } from "@bbm/shared";
import { describe, expect, it } from "vitest";
import { env } from "../lib/env.js";
import { getJson, postForm } from "../lib/http.js";
import { SAMPLE_SOURCE, contractForm, validFields } from "./support.js";

const contractsUrl = `${env.apiUrl}/api/contracts`;

describe("API: health", () => {
  it("GET /health answers 200", async () => {
    const res = await fetch(`${env.apiUrl}/health`);
    expect(res.status).toBe(200);
  });
});

describe("API: POST /api/contracts", () => {
  it("creates a contract (201) whose body matches the shared Contract schema", async () => {
    const fields = validFields();
    const { status, body } = await postForm(contractsUrl, contractForm(fields), ContractSchema);

    expect(status).toBe(201);
    const sourceHash = createHash("sha256").update(SAMPLE_SOURCE).digest("hex");
    expect(body).toMatchObject({
      developerAddress: fields.developerAddress,
      filename: "Sample.sol",
      sourceHash,
      sourceReference: `contracts/${body.id}/${sourceHash}.sol`,
      status: "Open",
      deadline: fields.deadline,
    });
    expect(body.bountyId).toBeTruthy();
    expect(Date.parse(body.createdAt)).not.toBeNaN();
  });

  it("round-trips: GET /api/contracts/:id returns the created contract", async () => {
    const created = await postForm(contractsUrl, contractForm(validFields()), ContractSchema);
    expect(created.status).toBe(201);

    const fetched = await getJson(`${contractsUrl}/${created.body.id}`, ContractSchema);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(created.body);
  });

  it("assigns distinct ids to identical submissions", async () => {
    const fields = validFields();
    const a = await postForm(contractsUrl, contractForm(fields), ContractSchema);
    const b = await postForm(contractsUrl, contractForm(fields), ContractSchema);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).not.toBe(b.body.id);
    expect(a.body.sourceHash).toBe(b.body.sourceHash);
  });

  it("rejects invalid fields with 400 and lists every issue", async () => {
    const { status, body } = await postForm<never>(
      contractsUrl,
      contractForm(validFields({ developerAddress: "0x123", bountyAmount: "0", deadline: "soon" })),
    );
    expect(status).toBe(400);
    const err = body as { error: string; issues: string[] };
    expect(err.error).toBe("Invalid contract submission");
    expect(err.issues.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects a non-.sol file with 400", async () => {
    const { status, body } = await postForm<never>(
      contractsUrl,
      contractForm(validFields(), { name: "notes.txt", content: SAMPLE_SOURCE }),
    );
    expect(status).toBe(400);
    expect((body as { issues: string[] }).issues).toContain("Filename must end in .sol");
  });

  it("rejects a request with no file part with 400", async () => {
    const { status, body } = await postForm<never>(contractsUrl, contractForm(validFields(), null));
    expect(status).toBe(400);
    expect(body).toEqual({ error: "file is required" });
  });

  it("rejects a file over 100 KB with 413", async () => {
    const big = new Uint8Array(CONTRACT_SOURCE_MAX_BYTES + 1).fill(0x61);
    const { status } = await postForm<never>(
      contractsUrl,
      contractForm(validFields(), { name: "Big.sol", content: big }),
    );
    expect(status).toBe(413);
  });
});

describe("API: GET /api/contracts/:id", () => {
  it("answers 404 { error } for an unknown id", async () => {
    const { status, body } = await getJson<never>(
      `${contractsUrl}/contract_does-not-exist-${Date.now()}`,
    );
    expect(status).toBe(404);
    expect(body).toEqual({ error: "Not found" });
  });
});
