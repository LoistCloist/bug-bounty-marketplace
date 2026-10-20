export interface PipelineConfig {
  /** How long an auditor's exclusive claim on a contract lasts. */
  claimWindowSeconds: number;
  /** Injectable clock for tests. */
  now: () => Date;
}

export function loadPipelineConfig(env: NodeJS.ProcessEnv = process.env): PipelineConfig {
  const claimWindowSeconds = Number(env.CLAIM_WINDOW_SECONDS ?? 600);
  if (!Number.isFinite(claimWindowSeconds) || claimWindowSeconds <= 0) {
    throw new Error("CLAIM_WINDOW_SECONDS must be a positive number");
  }
  return { claimWindowSeconds, now: () => new Date() };
}
