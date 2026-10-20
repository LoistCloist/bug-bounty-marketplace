import { describe, expect, it } from "vitest";
import { AnalysisStatusSchema, ContractSchema, FindingSchema } from "@bbm/shared";
import { env } from "../lib/env.js";
import { getJson, postForm } from "../lib/http.js";

// The analysis worker is always up in docker compose, but on Azure Container
// Apps it is optional and internal-only (not reachable from the runner), so
// the Azure workflows set BBM_SKIP_ANALYSIS=1.
const skip = process.env.BBM_SKIP_ANALYSIS === "1";

/** Re-enters withdraw() before zeroing the balance: Slither flags reentrancy-eth. */
const VAULT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
contract Vault {
    mapping(address => uint256) public balances;
    function deposit() external payable { balances[msg.sender] += msg.value; }
    function withdraw() external {
        uint256 bal = balances[msg.sender];
        (bool ok, ) = msg.sender.call{value: bal}("");
        require(ok);
        balances[msg.sender] = 0;
    }
}
`;

function analyze(body: unknown): Promise<Response> {
  return fetch(`${env.analysisUrl}/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(skip)("analysis worker", () => {
  it("GET /health answers { status: ok }", async () => {
    const res = await fetch(`${env.analysisUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it(
    "POST /analyze runs Slither and returns explained findings",
    { timeout: 120_000 },
    async () => {
      const res = await analyze({ contractId: "contract_it", source: VAULT });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        solcVersion: string;
        findings: Array<{ slitherDetector: string; severity: string; llmExplanation: string }>;
      };
      expect(body.solcVersion).toMatch(/^0\.8\./);
      const reentrancy = body.findings.find((f) => f.slitherDetector === "reentrancy-eth");
      expect(reentrancy?.severity).toBe("High");
      expect(reentrancy?.llmExplanation.length).toBeGreaterThan(0);
    },
  );

  it("POST /analyze explains why it can't analyse an unsupported pragma (422)", async () => {
    const res = await analyze({
      contractId: "c",
      source: "pragma solidity ^0.6.0;\ncontract A {}\n",
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ detail: "Unsupported Solidity version: ^0.6.0" });
  });

  it("POST /analyze validates its body (422 on missing fields)", async () => {
    const res = await analyze({});
    expect(res.status).toBe(422);
  });

  it(
    "analyses a contract uploaded through the API (job queue → worker → findings)",
    { timeout: 180_000 },
    async () => {
      const form = new FormData();
      form.set("file", new File([VAULT], "Vault.sol"));
      form.set("developerAddress", `0x${"1".repeat(40)}`);
      form.set("bountyAmount", "1000000000000000000");
      form.set("deadline", "2030-01-01T00:00:00.000Z");
      const created = await postForm(`${env.apiUrl}/api/contracts`, form, ContractSchema);
      expect(created.status).toBe(201);
      const id = created.body.id;

      let status = "Queued";
      for (let i = 0; i < 170 && (status === "Queued" || status === "Running"); i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const res = await getJson(
          `${env.apiUrl}/api/contracts/${id}/analysis`,
          AnalysisStatusSchema,
        );
        status = res.body.status;
      }
      expect(status).toBe("Done");

      const findings = await getJson(
        `${env.apiUrl}/api/contracts/${id}/findings`,
        FindingSchema.array(),
      );
      expect(findings.body.map((f) => f.slitherDetector)).toContain("reentrancy-eth");
      expect(findings.body.every((f) => f.status === "Flagged")).toBe(true);
    },
  );
});
