import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { MemoryContractRepository } from "./contracts/memory-repository.js";
import type { ContractRepository } from "./contracts/repository.js";
import { registerContractRoutes, CONTRACT_MULTIPART_LIMITS } from "./contracts/routes.js";
import { MemorySourceStorage, type SourceStorage } from "./contracts/storage.js";

export interface AppOptions {
  /** Defaults to an in-memory repository. `index.ts` wires Postgres when
   * DATABASE_URL is set. */
  repository?: ContractRepository;
  /** Defaults to in-memory object storage. `index.ts` wires local disk when
   * SOURCE_STORAGE_DIR is set. */
  storage?: SourceStorage;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  void app.register(multipart, { limits: CONTRACT_MULTIPART_LIMITS });
  registerContractRoutes(app, {
    repository: options.repository ?? new MemoryContractRepository(),
    storage: options.storage ?? new MemorySourceStorage(),
  });

  return app;
}
