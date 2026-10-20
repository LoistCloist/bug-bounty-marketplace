import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common";

/** State of a contract's latest analysis job (Slither + LLM explanations),
 * as reported by `GET /api/contracts/:id/analysis`. */
export const AnalysisJobStatusSchema = z.enum(["Queued", "Running", "Done", "Failed"]);
export type AnalysisJobStatus = z.infer<typeof AnalysisJobStatusSchema>;

export const AnalysisStatusSchema = z.object({
  contractId: IdSchema,
  status: AnalysisJobStatusSchema,
  /** Why the analysis failed (e.g. the solc compile error). Null unless
   * `status` is Failed. */
  error: z.string().nullable(),
  /** Findings stored for the contract so far. */
  findingCount: z.number().int().nonnegative(),
  updatedAt: TimestampSchema,
});
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;
