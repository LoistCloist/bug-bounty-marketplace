/**
 * Tiny timer registry keyed by an arbitrary string key, used to drive every
 * time-based mock transition (analysis completion, sandbox resolution, the
 * challenge-window auto-pay). Keying by id lets a later event (e.g. a
 * dispute opened against a finding) cancel a pending transition (the
 * finding's auto-pay) before it fires.
 *
 * Uses the global `setTimeout`/`clearTimeout` at call time (not captured at
 * module load), so `vi.useFakeTimers()` in tests transparently controls
 * every scheduled transition here.
 */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleOnce(key: string, delayMs: number, fn: () => void): void {
  cancelScheduled(key);
  const handle = setTimeout(() => {
    timers.delete(key);
    fn();
  }, delayMs);
  timers.set(key, handle);
}

export function cancelScheduled(key: string): void {
  const existing = timers.get(key);
  if (existing !== undefined) {
    clearTimeout(existing);
    timers.delete(key);
  }
}

export function isScheduled(key: string): boolean {
  return timers.has(key);
}

/** Cancels every pending timer. Call this between test runs so timers never
 * leak across Vitest tests/files. */
export function cancelAllScheduled(): void {
  for (const handle of timers.values()) {
    clearTimeout(handle);
  }
  timers.clear();
}
