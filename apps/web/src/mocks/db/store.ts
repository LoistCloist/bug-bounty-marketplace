import type {
  AuditorProfile,
  Bounty,
  Contract,
  Dispute,
  Finding,
  PoCSubmission,
} from "@bbm/shared";

/**
 * The single in-memory mock "database". Split into per-area modules
 * (contracts.ts, auditors.ts, disputes.ts) that each own a slice of this
 * shared state — the split is about which file *defines* the routes/mutates
 * a given slice, not about isolating the data itself.
 */
export interface MockDb {
  contracts: Contract[];
  bounties: Bounty[];
  findings: Finding[];
  pocSubmissions: PoCSubmission[];
  auditorProfiles: AuditorProfile[];
  disputes: Dispute[];
}

export const db: MockDb = {
  contracts: [],
  bounties: [],
  findings: [],
  pocSubmissions: [],
  auditorProfiles: [],
  disputes: [],
};
