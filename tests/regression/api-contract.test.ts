/**
 * Regression: the externally visible contracts API, locked to golden files.
 *
 * Every request below uses FIXED inputs (tests/fixtures/Sample.sol plus the
 * constant form fields), so the only volatile parts of a response are the
 * server-generated ids and the `createdAt` timestamp. Those are replaced with
 * placeholders (`<id>`, `<bountyId>`, `<timestamp>`) wherever they appear,
 * including inside other fields such as `sourceReference`; keys are sorted
 * and the JSON is written with a 2-space indent and trailing newline. Any
 * other change to a status code, field name, field value or error message
 * makes the golden diff and fails CI.
 *
 * Goldens live in tests/regression/__golden__/. When an API change is
 * intentional, regenerate them against a running stack with
 *
 *   pnpm --filter @bbm/system-tests test:regression -u
 *
 * and commit the updated files. Golden diffs MUST be reviewed in the PR like
 * any other API change: they are the record of what clients see.
 *
 * Other regression gates already run in CI and are deliberately not
 * duplicated here: the contracts gas snapshot (`forge snapshot --check`) and
 * the shared JSON-schema drift check for packages/shared/schema/*.json.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ContractSchema, CONTRACT_SOURCE_MAX_BYTES, type Contract } from "@bbm/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { env } from "../lib/env.js";
import { redact, stableStringify } from "../lib/golden.js";
import { getJson, postForm, type JsonResponse } from "../lib/http.js";

const GOLDEN = "./__golden__";
const contractsUrl = `${env.apiUrl}/api/contracts`;

const sampleSource = readFileSync(new URL("../fixtures/Sample.sol", import.meta.url));
/** Known sha256 of tests/fixtures/Sample.sol. If this fails the fixture (or
 * its line endings) changed, which would silently move every golden. */
const SAMPLE_SHA256 = "d0e70b2f29d09aff0d9b31f6e6b69ec143466a82cf12c8609735f287f83d7649";

const fixedFields = {
  developerAddress: "0x00000000000000000000000000000000000dEaD1",
  bountyAmount: "1.5",
  currency: "ETH",
  deadline: "2030-01-01T00:00:00.000Z",
} as const;

function form(
  fields: Record<string, string>,
  file?: { name: string; content: Uint8Array },
): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  if (file) fd.append("file", new Blob([file.content], { type: "text/plain" }), file.name);
  return fd;
}

/** Placeholders for the server-generated values of one contract. */
function volatileOf(contract: Contract): Map<string, string> {
  return new Map([
    [contract.id, "<id>"],
    [contract.bountyId, "<bountyId>"],
    [contract.createdAt, "<timestamp>"],
  ]);
}

function golden(res: JsonResponse<unknown>, volatile: ReadonlyMap<string, string> = new Map()) {
  return stableStringify({ status: res.status, body: redact(res.body, volatile) });
}

describe("contracts API contract (goldens)", () => {
  let posted: JsonResponse<Contract>;

  beforeAll(async () => {
    posted = await postForm(
      contractsUrl,
      form(fixedFields, { name: "Sample.sol", content: sampleSource }),
      ContractSchema,
    );
  });

  it("fixture hash is deterministic", () => {
    const hash = createHash("sha256").update(sampleSource).digest("hex");
    expect(hash).toBe(SAMPLE_SHA256);
    expect(posted.body.sourceHash).toBe(hash);
  });

  it("POST /api/contracts matches golden", async () => {
    expect(posted.status).toBe(201);
    // Sanity-check the values we redact so a placeholder never hides a bug.
    expect(posted.body.id).toMatch(/^contract_[0-9a-f-]{36}$/);
    expect(posted.body.bountyId).toMatch(/^bounty_[0-9a-f-]{36}$/);
    expect(Math.abs(Date.parse(posted.body.createdAt) - Date.now())).toBeLessThan(10 * 60_000);

    const out = golden(posted, volatileOf(posted.body));
    expect(out).not.toContain(posted.body.id);
    expect(out).not.toContain(posted.body.createdAt);
    await expect(out).toMatchFileSnapshot(`${GOLDEN}/post-contract.json`);
  });

  it("GET /api/contracts/:id matches golden", async () => {
    const res = await getJson(`${contractsUrl}/${posted.body.id}`, ContractSchema);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(posted.body);
    await expect(golden(res, volatileOf(posted.body))).toMatchFileSnapshot(
      `${GOLDEN}/get-contract.json`,
    );
  });

  describe("error shapes", () => {
    it("404 unknown id", async () => {
      const res = await getJson(`${contractsUrl}/contract_00000000-0000-0000-0000-000000000000`);
      await expect(golden(res)).toMatchFileSnapshot(`${GOLDEN}/errors/404-unknown-id.json`);
    });

    it("400 validation (every field invalid)", async () => {
      const res = await postForm(
        contractsUrl,
        form(
          {
            developerAddress: "0xnot-an-address",
            bountyAmount: "-1",
            currency: "",
            deadline: "next tuesday",
          },
          { name: "Sample.txt", content: sampleSource },
        ),
      );
      await expect(golden(res)).toMatchFileSnapshot(`${GOLDEN}/errors/400-validation.json`);
    });

    it("400 missing file", async () => {
      const res = await postForm(contractsUrl, form(fixedFields));
      await expect(golden(res)).toMatchFileSnapshot(`${GOLDEN}/errors/400-missing-file.json`);
    });

    it("413 oversize source", async () => {
      const oversize = new Uint8Array(CONTRACT_SOURCE_MAX_BYTES + 1).fill(0x20);
      const res = await postForm(
        contractsUrl,
        form(fixedFields, { name: "Big.sol", content: oversize }),
      );
      await expect(golden(res)).toMatchFileSnapshot(`${GOLDEN}/errors/413-oversize.json`);
    });
  });
});
