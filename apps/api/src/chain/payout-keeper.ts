export interface PayoutKeeperOptions {
  /** One pass of work, e.g. ChainActions.runPayoutsOnce bound to the clock. */
  runOnce: () => Promise<unknown>;
  intervalMs: number;
  /** Where a failed pass is reported; the keeper keeps running. */
  onError?: (err: unknown) => void;
}

export interface PayoutKeeper {
  /** Stops the timer and waits for a pass already in flight. */
  stop(): Promise<void>;
}

/**
 * Runs `runOnce` every `intervalMs`. Passes never overlap: if one is still
 * running when the next tick fires, that tick is skipped. The timer is
 * unref'd so the keeper alone does not keep the process alive.
 */
export function startPayoutKeeper(options: PayoutKeeperOptions): PayoutKeeper {
  const onError = options.onError ?? ((err: unknown) => console.error("payout keeper pass failed", err));
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped || inFlight) return;
    inFlight = options
      .runOnce()
      .then(
        () => undefined,
        (err: unknown) => onError(err),
      )
      .finally(() => {
        inFlight = null;
      });
  };

  const timer = setInterval(tick, options.intervalMs);
  timer.unref();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}
