import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { MemoryContractRepository } from "./contracts/memory-repository.js";
import type { ContractRepository } from "./contracts/repository.js";
import { registerContractRoutes, CONTRACT_MULTIPART_LIMITS } from "./contracts/routes.js";
import { MemorySourceStorage, type SourceStorage } from "./contracts/storage.js";
import type { AuditorStakingPort } from "./chain/auditor-staking.js";
import { loadPipelineConfig, type PipelineConfig } from "./pipeline/config.js";
import { MemoryPipelineRepository, MemoryStore } from "./pipeline/memory-repository.js";
import type { PipelineRepository } from "./pipeline/repository.js";
import { registerPipelineRoutes } from "./pipeline/routes.js";
import { NotConfiguredVerdictSource, type PocVerdictSource } from "./pipeline/verdict-source.js";

export interface AppOptions {
  /** Defaults to an in-memory repository. `index.ts` wires Postgres when
   * DATABASE_URL is set. Pass `repository` and `pipeline` together so they
   * share the same data. */
  repository?: ContractRepository;
  /** Defaults to in-memory findings/PoCs/jobs. Nothing processes in-memory
   * jobs; the analysis worker needs Postgres. */
  pipeline?: PipelineRepository;
  /** Defaults to in-memory object storage. `index.ts` wires local disk when
   * SOURCE_STORAGE_DIR is set. */
  storage?: SourceStorage;
  /** Defaults to loadPipelineConfig() (env vars, real clock). */
  config?: PipelineConfig;
  /** Omit when no chain is configured; claims then skip the on-chain lock. */
  auditorStaking?: AuditorStakingPort;
  /** Read-only AuditorStaking reader for the PoC stake gate. Omit or pass null
   * when no chain is configured: the gate is then skipped and logged. */
  stakeReader?: Pick<AuditorStakingPort, "stakeOf"> | null;
  /** Sandbox verdict source for PoC uploads. Defaults to NotConfiguredVerdictSource,
   * which leaves every PoC Pending. */
  verdicts?: PocVerdictSource;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  const store = new MemoryStore();
  const repository = options.repository ?? new MemoryContractRepository(store);
  const pipeline = options.pipeline ?? new MemoryPipelineRepository(store);
  const storage = options.storage ?? new MemorySourceStorage();
  const config = options.config ?? loadPipelineConfig();

  void app.register(multipart, { limits: CONTRACT_MULTIPART_LIMITS });
  registerContractRoutes(app, { repository, storage, now: config.now });
  registerPipelineRoutes(app, {
    contracts: repository,
    pipeline,
    storage,
    config,
    auditorStaking: options.auditorStaking,
    stakeReader: options.stakeReader ?? null,
    verdicts: options.verdicts ?? new NotConfiguredVerdictSource(),
  });

  return app;
}
