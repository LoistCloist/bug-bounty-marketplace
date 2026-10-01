// Sanity check that the committed packages/shared/schema/*.json files exist,
// are valid JSON, and currently match what the Zod schemas would generate.
// This complements (but doesn't replace) the CI staleness check in
// .github/workflows/ci.yml, which re-runs `gen:schema` and diffs the result
// against what's committed.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AuditorProfileSchema,
  BountySchema,
  ContractSchema,
  DisputeSchema,
  FindingSchema,
  FindingStatusSchema,
  PoCSubmissionSchema,
} from "../index.js";

const schemaDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "schema",
);

const entities: Record<string, z.ZodType> = {
  Contract: ContractSchema,
  Bounty: BountySchema,
  Finding: FindingSchema,
  FindingStatus: FindingStatusSchema,
  PoCSubmission: PoCSubmissionSchema,
  Dispute: DisputeSchema,
  AuditorProfile: AuditorProfileSchema,
};

describe("generated JSON Schema output", () => {
  for (const [name, schema] of Object.entries(entities)) {
    it(`${name}.json exists, is valid JSON, and matches the current Zod schema`, () => {
      const filePath = path.join(schemaDir, `${name}.json`);
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      const fresh = z.toJSONSchema(schema);
      expect(parsed).toEqual(fresh);
    });
  }
});
