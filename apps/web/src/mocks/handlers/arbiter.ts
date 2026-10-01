import { http, HttpResponse } from "msw";
import type { DisputeRuling } from "@bbm/shared";
import { db } from "../db/store";
import { findFindingById } from "../db/contracts";
import { listDisputes, ruleOnDispute } from "../db/disputes";
import { errorResponse } from "./util";

const RULING_VALUES = new Set<DisputeRuling>(["Pending", "ForAuditor", "AgainstAuditor"]);

/**
 * Arbiter-flow routes: list open disputes (enriched with the finding and
 * PoC sandbox log so the arbiter can review without extra round trips) and
 * rule on one. Owns no routes outside this area.
 */
export const arbiterHandlers = [
  http.get("*/api/arbiter/disputes", ({ request }) => {
    const url = new URL(request.url);
    const rulingParam = url.searchParams.get("ruling");
    const ruling =
      rulingParam && RULING_VALUES.has(rulingParam as DisputeRuling)
        ? (rulingParam as DisputeRuling)
        : undefined;

    const disputes = listDisputes(ruling ? { ruling } : undefined);
    const enriched = disputes.map((dispute) => ({
      ...dispute,
      finding: findFindingById(dispute.findingId) ?? null,
      pocSubmission: db.pocSubmissions.find((p) => p.findingId === dispute.findingId) ?? null,
    }));
    return HttpResponse.json(enriched);
  }),

  http.post("*/api/arbiter/disputes/:id/rule", async ({ params, request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      arbiterId?: string;
      ruling?: "ForAuditor" | "AgainstAuditor";
    };
    if (!body.arbiterId || (body.ruling !== "ForAuditor" && body.ruling !== "AgainstAuditor")) {
      return HttpResponse.json(
        { error: "arbiterId and ruling ('ForAuditor' | 'AgainstAuditor') are required" },
        { status: 400 },
      );
    }
    try {
      const dispute = ruleOnDispute(String(params.id), body.arbiterId, body.ruling);
      return HttpResponse.json(dispute);
    } catch (err) {
      return errorResponse(err);
    }
  }),
];
