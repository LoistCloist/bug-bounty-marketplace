import type { FastifyInstance } from "fastify";
import { CONTRACT_SOURCE_MAX_BYTES } from "@bbm/shared";
import type { ContractRepository } from "./repository.js";
import type { SourceStorage } from "./storage.js";
import { ContractValidationError, submitContract } from "./service.js";

export interface ContractRouteDeps {
  repository: ContractRepository;
  storage: SourceStorage;
}

/** Limits passed to @fastify/multipart. `fileSize` is the server-side cap on
 * the .sol upload; the service re-checks the byte length. */
export const CONTRACT_MULTIPART_LIMITS = {
  fileSize: CONTRACT_SOURCE_MAX_BYTES,
  files: 1,
  fields: 10,
} as const;

/** Registers `POST /api/contracts` and `GET /api/contracts/:id`. The app must
 * already have @fastify/multipart registered with CONTRACT_MULTIPART_LIMITS. */
export function registerContractRoutes(app: FastifyInstance, deps: ContractRouteDeps): void {
  app.post("/api/contracts", async (request, reply) => {
    const fields: Record<string, string> = {};
    let file: { filename: string; bytes: Buffer } | undefined;

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          const bytes = await part.toBuffer();
          if (part.fieldname === "file") {
            file = { filename: part.filename, bytes };
          }
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.code(413).send({ error: "Source file exceeds the 100 KB limit" });
      }
      if (code?.startsWith("FST_")) {
        return reply.code(400).send({ error: "Expected a multipart/form-data body" });
      }
      throw err;
    }

    if (!file) {
      return reply.code(400).send({ error: "file is required" });
    }

    try {
      const contract = await submitContract(deps, {
        filename: file.filename,
        bytes: file.bytes,
        fields,
      });
      return reply.code(201).send(contract);
    } catch (err) {
      if (err instanceof ContractValidationError) {
        return reply.code(400).send({ error: "Invalid contract submission", issues: err.issues });
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>("/api/contracts/:id", async (request, reply) => {
    const contract = await deps.repository.findContractById(request.params.id);
    if (!contract) {
      return reply.code(404).send({ error: "Not found" });
    }
    return contract;
  });
}
