import { http, HttpResponse } from "msw";
import {
  createContract,
  disputeFinding,
  findContractById,
  listContracts,
  listFindingsByContract,
  reclaimContract,
} from "../db/contracts";
import { openDispute } from "../db/disputes";
import { errorResponse } from "./util";

/**
 * Developer-flow routes: submit a contract, list contracts/findings,
 * dispute a finding, reclaim an expired bounty. Owns no routes outside this
 * area - see CLAUDE.md for the per-flow handler split.
 */
export const developerHandlers = [
  http.post("*/api/contracts", async ({ request }) => {
    const form = await request.formData();
    const file = form.get("file");
    const bountyAmount = Number(form.get("bountyAmount"));
    const currency = String(form.get("currency") ?? "ETH");
    const deadline = String(form.get("deadline") ?? "");
    const developerAddress = String(form.get("developerAddress") ?? "");

    if (!(file instanceof File)) {
      return HttpResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!deadline || !developerAddress || Number.isNaN(bountyAmount) || bountyAmount <= 0) {
      return HttpResponse.json(
        { error: "developerAddress, a positive bountyAmount, and deadline are required" },
        { status: 400 },
      );
    }

    try {
      const contract = createContract({
        developerAddress,
        filename: file.name,
        bountyAmount,
        currency,
        deadline,
      });
      return HttpResponse.json(contract, { status: 201 });
    } catch (err) {
      return errorResponse(err);
    }
  }),

  http.get("*/api/contracts", ({ request }) => {
    const url = new URL(request.url);
    const developerAddress = url.searchParams.get("developerAddress") ?? undefined;
    return HttpResponse.json(listContracts(developerAddress ? { developerAddress } : undefined));
  }),

  http.get("*/api/contracts/:id", ({ params }) => {
    const contract = findContractById(String(params.id));
    if (!contract) return HttpResponse.json({ error: "Not found" }, { status: 404 });
    return HttpResponse.json(contract);
  }),

  http.get("*/api/contracts/:id/findings", ({ params }) => {
    return HttpResponse.json(listFindingsByContract(String(params.id)));
  }),

  http.post("*/api/findings/:id/dispute", async ({ params, request }) => {
    const findingId = String(params.id);
    const body = (await request.json().catch(() => ({}))) as {
      developerId?: string;
      reason?: string;
    };
    if (!body.developerId || !body.reason) {
      return HttpResponse.json(
        { error: "developerId and reason are required" },
        { status: 400 },
      );
    }
    try {
      disputeFinding(findingId, body.developerId);
      const dispute = openDispute(findingId, body.developerId, body.reason);
      return HttpResponse.json(dispute, { status: 201 });
    } catch (err) {
      return errorResponse(err);
    }
  }),

  http.post("*/api/contracts/:id/reclaim", ({ params }) => {
    try {
      const contract = reclaimContract(String(params.id));
      return HttpResponse.json(contract);
    } catch (err) {
      return errorResponse(err);
    }
  }),
];
