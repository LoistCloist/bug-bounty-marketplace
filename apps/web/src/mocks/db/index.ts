import { db } from "./store";
import { cancelAllScheduled } from "./scheduler";
import { resetIdCounters } from "./ids";
import { seedContractsArea } from "./contracts";
import { seedAuditorsArea } from "./auditors";
import { seedDisputesArea } from "./disputes";

export { db } from "./store";
export type { MockDb } from "./store";
export * from "./errors";
export * from "./scheduler";
export * from "./ids";
export * from "./timing";
export * from "./contracts";
export * from "./auditors";
export * from "./disputes";

/** Clears every table, cancels all pending timers, and reseeds from
 * scratch. Call this in test `beforeEach`/`afterEach` (ideally alongside
 * `vi.useFakeTimers()`) to keep mock-flow tests deterministic and isolated
 * from each other. Also runs once at module load for normal dev/browser
 * use. */
export function resetMockDb(): void {
  cancelAllScheduled();
  resetIdCounters();
  db.contracts = [];
  db.bounties = [];
  db.findings = [];
  db.pocSubmissions = [];
  db.auditorProfiles = [];
  db.disputes = [];

  seedContractsArea();
  seedAuditorsArea();
  seedDisputesArea();
}

resetMockDb();
