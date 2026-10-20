import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { type PoCSubmission, PocSourceFilenameSchema, PocSourceSizeSchema } from "@bbm/shared";
import type { ContractRepository, QueueItem } from "../contracts/repository.js";
import type { SourceStorage } from "../contracts/storage.js";
import { readMultipart } from "../http/multipart.js";
import type { PipelineConfig } from "./config.js";
import type { PipelineRepository } from "./repository.js";

export interface PipelineRouteDeps {
  contracts: ContractRepository;
  pipeline: PipelineRepository;
  storage: SourceStorage;
  config: PipelineConfig;
}

const QUEUE_SORTS = ["deadline", "bounty", "newest"] as const;
type QueueSort = (typeof QUEUE_SORTS)[number];

function sortQueue(items: QueueItem[], sort: QueueSort | undefined): QueueItem[] {
  const by: Record<QueueSort, (a: QueueItem, b: QueueItem) => number> = {
    deadline: (a, b) => a.deadline.localeCompare(b.deadline),
    bounty: (a, b) => b.bounty.amount - a.bounty.amount,
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  };
  return sort ? [...items].sort(by[sort]) : items;
}

/** Storage key for an uploaded PoC, content-addressed like contract sources. */
export function pocStorageKey(pocId: string, sha256: string): string {
  return `pocs/${pocId}/${sha256}.t.sol`;
}

/** Routes backed by the analysis pipeline: findings, analysis status, the
 * auditor queue and claims, and PoC submission. */
export function registerPipelineRoutes(app: FastifyInstance, deps: PipelineRouteDeps): void {
  const { contracts, pipeline, storage, config } = deps;

  app.get<{ Params: { id: string } }>("/api/contracts/:id/findings", async (request, reply) => {
    const now = config.now();
    const contract = await contracts.findContractById(request.params.id, now);
    if (!contract) return reply.code(404).send({ error: "Not found" });
    return pipeline.listFindings(contract.id, now);
  });

  app.get<{ Params: { id: string } }>("/api/contracts/:id/analysis", async (request, reply) => {
    const status = await pipeline.getAnalysisStatus(request.params.id);
    if (!status) return reply.code(404).send({ error: "Not found" });
    return status;
  });

  app.get<{ Params: { id: string } }>("/api/findings/:id/raw", async (request, reply) => {
    const raw = await pipeline.getRawOutput(request.params.id);
    if (raw === null) return reply.code(404).send({ error: "Not found" });
    return reply.type("application/json").send(JSON.stringify(raw));
  });

  app.get<{ Querystring: { sort?: string } }>("/api/auditor/queue", async (request, reply) => {
    const sort = request.query.sort || undefined;
    if (sort !== undefined && !(QUEUE_SORTS as readonly string[]).includes(sort)) {
      return reply.code(400).send({ error: `sort must be one of ${QUEUE_SORTS.join(", ")}` });
    }
    return sortQueue(await contracts.listQueue(config.now()), sort as QueueSort | undefined);
  });

  app.post<{ Body: { contractId?: unknown; auditorId?: unknown } | undefined }>(
    "/api/auditor/claim",
    async (request, reply) => {
      const { contractId, auditorId } = request.body ?? {};
      if (
        typeof contractId !== "string" ||
        !contractId ||
        typeof auditorId !== "string" ||
        !auditorId
      ) {
        return reply.code(400).send({ error: "contractId and auditorId are required" });
      }
      const now = config.now();
      const expiresAt = new Date(now.getTime() + config.claimWindowSeconds * 1000);
      const result = await contracts.claimContract(contractId, auditorId, expiresAt, now);
      if (result.ok) return result.contract;
      if (result.reason === "not_found") return reply.code(404).send({ error: "Not found" });
      return reply.code(409).send({ error: `Contract ${contractId} is not open to claim` });
    },
  );

  app.post("/api/auditor/poc", async (request, reply) => {
    const body = await readMultipart(request);
    if (!body.ok) {
      return body.reason === "too_large"
        ? reply.code(413).send({ error: "PoC file exceeds the 100 KB limit" })
        : reply.code(400).send({ error: "Expected a multipart/form-data body" });
    }
    const { findingId, auditorId } = body.fields;
    if (!findingId || !auditorId || !body.file) {
      return reply.code(400).send({ error: "findingId, auditorId and file are required" });
    }
    const issues = [
      ...(PocSourceFilenameSchema.safeParse(body.file.filename).error?.issues ?? []),
      ...(PocSourceSizeSchema.safeParse(body.file.bytes.byteLength).error?.issues ?? []),
    ].map((issue) => issue.message);
    if (issues.length > 0) {
      return reply.code(400).send({ error: "Invalid PoC submission", issues });
    }

    const now = config.now();
    const finding = await pipeline.findFinding(findingId, now);
    if (!finding) return reply.code(404).send({ error: "Not found" });
    const claim = await contracts.findActiveClaim(finding.contractId, now);
    if (!claim || claim.auditorId !== auditorId) {
      return reply.code(403).send({ error: "You do not hold an active claim on this contract" });
    }
    if (finding.status !== "Flagged") {
      return reply.code(409).send({ error: "Finding is not Flagged" });
    }

    const pocId = `poc_${randomUUID()}`;
    const sha256 = createHash("sha256").update(body.file.bytes).digest("hex");
    const testFileReference = pocStorageKey(pocId, sha256);
    // Bytes first, row second: a failed insert leaves an orphan object rather
    // than a row pointing at nothing (same rule as contract uploads).
    await storage.put(testFileReference, body.file.bytes);

    const submittedAt = now.toISOString();
    const poc: PoCSubmission = {
      id: pocId,
      findingId,
      auditorId,
      testFileReference,
      submittedAt,
      sandboxStatus: "Pending",
      sandboxLog: null,
    };
    const outcome = await pipeline.submitPoc({
      poc,
      findingId,
      now: submittedAt,
      job: { id: `job_${randomUUID()}`, kind: "sandbox", subjectId: pocId, createdAt: submittedAt },
    });
    if (outcome === "no_claim") {
      return reply.code(403).send({ error: "You do not hold an active claim on this contract" });
    }
    if (outcome === "not_flagged") {
      return reply.code(409).send({ error: "Finding is not Flagged" });
    }
    return reply.code(201).send(poc);
  });
}
