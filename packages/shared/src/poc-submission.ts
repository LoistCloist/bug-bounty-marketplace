import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common";

export const SandboxStatusSchema = z.enum(["Pending", "Passed", "Failed"]);
export type SandboxStatus = z.infer<typeof SandboxStatusSchema>;

export const PoCSubmissionSchema = z.object({
  id: IdSchema,
  findingId: IdSchema,
  auditorId: IdSchema,
  /** Reference to the submitted Foundry `.t.sol` test (storage key or URI). */
  testFileReference: z.string().min(1),
  submittedAt: TimestampSchema,
  sandboxStatus: SandboxStatusSchema,
  /** Populated once the sandbox has run; null while Pending. */
  sandboxLog: z.string().nullable().default(null),
});
export type PoCSubmission = z.infer<typeof PoCSubmissionSchema>;
