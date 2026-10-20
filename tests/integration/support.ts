import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Helpers shared by the integration tests (not a test file itself). */

export const SAMPLE_PATH = fileURLToPath(new URL("../fixtures/Sample.sol", import.meta.url));
export const SAMPLE_SOURCE = readFileSync(SAMPLE_PATH);

/** A fresh developer address per call, so reruns against a persistent DB
 * never collide with rows from earlier runs. */
export function uniqueAddress(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

export interface SubmissionFields {
  developerAddress: string;
  bountyAmount: string;
  currency: string;
  deadline: string;
}

export function validFields(overrides: Partial<SubmissionFields> = {}): SubmissionFields {
  return {
    developerAddress: uniqueAddress(),
    bountyAmount: "1.5",
    currency: "ETH",
    deadline: "2030-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Builds the multipart body for `POST /api/contracts`. */
export function contractForm(
  fields: Partial<SubmissionFields> = {},
  file: { name: string; content: Uint8Array } | null = {
    name: "Sample.sol",
    content: SAMPLE_SOURCE,
  },
): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.append(key, value);
  }
  if (file) {
    form.append("file", new Blob([file.content], { type: "text/plain" }), file.name);
  }
  return form;
}
