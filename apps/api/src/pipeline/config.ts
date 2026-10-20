import { parseIntEnv } from "../env.js";

export interface PipelineConfig {
  /** How long an auditor's exclusive claim on a contract lasts. */
  claimWindowSeconds: number;
  /** Injectable clock for tests. */
  now: () => Date;
}

/** Reads CLAIM_WINDOW_SECONDS like the API's other integer env vars: unset,
 * empty or invalid values fall back to the default (600). */
export function loadPipelineConfig(env: NodeJS.ProcessEnv = process.env): PipelineConfig {
  return {
    claimWindowSeconds: parseIntEnv(env.CLAIM_WINDOW_SECONDS, 600),
    now: () => new Date(),
  };
}
