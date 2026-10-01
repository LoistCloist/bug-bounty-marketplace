// Generates one JSON Schema file per top-level entity schema into
// packages/shared/schema/. Run via `pnpm --filter @bbm/shared run gen:schema`.
//
// CI (.github/workflows/ci.yml, `shared` job) re-runs this script and then
// `git diff --exit-code -- packages/shared/schema` to catch generated
// output that drifted from the Zod schemas it was derived from - so the
// committed schema/*.json files must always be exactly what this script
// produces, with no manual edits afterward.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
  AuditorProfileSchema,
  BountySchema,
  ContractSchema,
  DisputeSchema,
  FindingSchema,
  FindingStatusSchema,
  PoCSubmissionSchema,
} from "../src/index";

const entities: Record<string, z.ZodType> = {
  Contract: ContractSchema,
  Bounty: BountySchema,
  Finding: FindingSchema,
  FindingStatus: FindingStatusSchema,
  PoCSubmission: PoCSubmissionSchema,
  Dispute: DisputeSchema,
  AuditorProfile: AuditorProfileSchema,
};

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "schema");

async function main() {
  await mkdir(outDir, { recursive: true });

  for (const [name, schema] of Object.entries(entities)) {
    const jsonSchema = z.toJSONSchema(schema);
    const outPath = path.join(outDir, `${name}.json`);
    // Trailing newline so the committed files satisfy standard
    // end-of-file-newline conventions and diff cleanly.
    await writeFile(outPath, `${JSON.stringify(jsonSchema, null, 2)}\n`, "utf8");
    console.log(`wrote ${path.relative(process.cwd(), outPath)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
