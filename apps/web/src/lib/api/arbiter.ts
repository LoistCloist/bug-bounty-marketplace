import { z } from "zod";
import { DisputeSchema, FindingSchema, PoCSubmissionSchema, type Dispute } from "@bbm/shared";
import { getJson, postJson, toQueryString } from "./http";

/** A dispute enriched with the contested finding and its PoC sandbox log,
 * so the arbiter can review both parties' positions without extra round
 * trips: `reason` is the developer's challenge, and the finding/PoC carry
 * the auditor's side (the LLM explanation, the PoC, the sandbox log). */
export const ArbiterDisputeViewSchema = DisputeSchema.extend({
  finding: FindingSchema.nullable(),
  pocSubmission: PoCSubmissionSchema.nullable(),
});
export type ArbiterDisputeView = z.infer<typeof ArbiterDisputeViewSchema>;

/** GET /api/arbiter/disputes[?ruling=Pending|ForAuditor|AgainstAuditor] */
export function listDisputes(params?: {
  ruling?: "Pending" | "ForAuditor" | "AgainstAuditor";
}): Promise<ArbiterDisputeView[]> {
  return getJson(
    `/api/arbiter/disputes${toQueryString({ ruling: params?.ruling })}`,
    z.array(ArbiterDisputeViewSchema),
  );
}

/** POST /api/arbiter/disputes/:id/rule */
export function ruleOnDispute(
  disputeId: string,
  input: { arbiterId: string; ruling: "ForAuditor" | "AgainstAuditor" },
): Promise<Dispute> {
  return postJson(`/api/arbiter/disputes/${disputeId}/rule`, input, DisputeSchema);
}
