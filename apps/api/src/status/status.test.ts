import { describe, expect, it } from "vitest";
import type { ContractStatus, FindingStatus } from "@bbm/shared";
import { applyFindingTransition, FindingNotFoundError } from "./finding-writer.js";
import { MemoryFindingStatusStore } from "./memory-finding-status.js";
import {
  CONTRACT_TRANSITIONS,
  FINDING_TRANSITIONS,
  InvalidTransitionError,
  transitionContract,
  transitionFinding,
} from "./transitions.js";

const ALL_FINDING: FindingStatus[] = [
  "Flagged",
  "Submitted",
  "Verified",
  "Disputed",
  "Rejected",
  "Paid",
];
const T = "2026-10-20T10:00:00.000Z";

describe("finding transitions", () => {
  const allowed: [FindingStatus, FindingStatus][] = [
    ["Flagged", "Submitted"],
    ["Flagged", "Rejected"],
    ["Submitted", "Verified"],
    ["Submitted", "Rejected"],
    ["Verified", "Disputed"],
    ["Verified", "Paid"],
    ["Disputed", "Rejected"],
    ["Disputed", "Verified"],
  ];

  it.each(allowed)("allows %s -> %s", (from, to) => {
    expect(transitionFinding(from, to)).toBe(to);
  });

  const illegal: [FindingStatus, FindingStatus][] = [
    ["Paid", "Flagged"],
    ["Rejected", "Verified"],
    ["Flagged", "Verified"],
    ["Flagged", "Paid"],
    ["Submitted", "Paid"],
    ["Verified", "Rejected"],
    ["Verified", "Flagged"],
    ["Disputed", "Paid"],
    ["Rejected", "Submitted"],
  ];

  it.each(illegal)("rejects %s -> %s with InvalidTransitionError", (from, to) => {
    expect(() => transitionFinding(from, to)).toThrow(InvalidTransitionError);
  });

  it("covers every status pair exactly once in the table", () => {
    const pairs = ALL_FINDING.flatMap((from) => ALL_FINDING.map((to) => [from, to] as const));
    const legal = pairs.filter(([f, t]) => FINDING_TRANSITIONS[f].includes(t));
    expect(legal).toHaveLength(allowed.length);
    for (const [from, to] of pairs) {
      const expected = allowed.some(([f, t]) => f === from && t === to);
      expect(FINDING_TRANSITIONS[from].includes(to)).toBe(expected);
    }
  });

  it("exposes the typed error fields", () => {
    try {
      transitionFinding("Paid", "Flagged");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      expect(err).toMatchObject({ kind: "finding", from: "Paid", to: "Flagged" });
    }
  });
});

describe("contract transitions", () => {
  const allowed: [ContractStatus, ContractStatus][] = [
    ["Open", "Claimed"],
    ["Open", "Expired"],
    ["Claimed", "Open"],
    ["Claimed", "Resolved"],
    ["Claimed", "Expired"],
  ];

  it.each(allowed)("allows %s -> %s", (from, to) => {
    expect(transitionContract(from, to)).toBe(to);
  });

  const illegal: [ContractStatus, ContractStatus][] = [
    ["Open", "Resolved"],
    ["Resolved", "Open"],
    ["Expired", "Open"],
    ["Expired", "Claimed"],
    ["Resolved", "Claimed"],
  ];

  it.each(illegal)("rejects %s -> %s", (from, to) => {
    expect(() => transitionContract(from, to)).toThrow(InvalidTransitionError);
  });

  it("has no transitions out of terminal states", () => {
    expect(CONTRACT_TRANSITIONS.Resolved).toEqual([]);
    expect(CONTRACT_TRANSITIONS.Expired).toEqual([]);
  });

  describe("exhaustive pairs", () => {
    // Rules encoded explicitly here (not read from CONTRACT_TRANSITIONS), so a
    // change to the table fails this test.
    const ALL_CONTRACT: ContractStatus[] = ["Open", "Claimed", "Resolved", "Expired"];
    const LEGAL_CONTRACT: [ContractStatus, ContractStatus][] = [
      ["Open", "Claimed"],
      ["Open", "Expired"],
      ["Claimed", "Open"],
      ["Claimed", "Resolved"],
      ["Claimed", "Expired"],
    ];
    const pairs = ALL_CONTRACT.flatMap((from) => ALL_CONTRACT.map((to) => [from, to] as const));

    it("covers 16 pairs with 5 legal", () => {
      expect(pairs).toHaveLength(16);
      expect(LEGAL_CONTRACT).toHaveLength(5);
    });

    it.each(pairs)("%s -> %s returns the expected result or throws", (from, to) => {
      const legal = LEGAL_CONTRACT.some(([f, t]) => f === from && t === to);
      if (legal) {
        expect(transitionContract(from, to)).toBe(to);
      } else {
        expect(() => transitionContract(from, to)).toThrow(InvalidTransitionError);
      }
    });

    it("has no outgoing transitions from Resolved or Expired", () => {
      for (const terminal of ["Resolved", "Expired"] as const) {
        for (const to of ALL_CONTRACT) {
          expect(() => transitionContract(terminal, to)).toThrow(InvalidTransitionError);
        }
      }
    });
  });
});

describe("applyFindingTransition", () => {
  it("validates, writes the status and appends a history entry with changedAt", async () => {
    const store = new MemoryFindingStatusStore();
    store.add("f1", "Flagged", "2026-10-19T09:00:00.000Z");

    await applyFindingTransition(store, "f1", "Submitted", T);
    await applyFindingTransition(store, "f1", "Verified", "2026-10-20T11:00:00.000Z");

    expect(await store.getFindingStatus("f1")).toBe("Verified");
    expect(store.history("f1")).toEqual([
      { status: "Flagged", changedAt: "2026-10-19T09:00:00.000Z" },
      { status: "Submitted", changedAt: T },
      { status: "Verified", changedAt: "2026-10-20T11:00:00.000Z" },
    ]);
  });

  it("maps a lost dispute to Rejected", async () => {
    const store = new MemoryFindingStatusStore();
    store.add("f2", "Verified", T);
    await applyFindingTransition(store, "f2", "Disputed", T);
    await expect(applyFindingTransition(store, "f2", "Rejected", T)).resolves.toBe("Rejected");
    expect(store.history("f2").at(-1)).toEqual({ status: "Rejected", changedAt: T });
  });

  it("throws and writes nothing on an illegal move", async () => {
    const store = new MemoryFindingStatusStore();
    store.add("f3", "Rejected", T);
    await expect(applyFindingTransition(store, "f3", "Verified", T)).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    expect(await store.getFindingStatus("f3")).toBe("Rejected");
    expect(store.history("f3")).toHaveLength(1);
  });

  it("throws FindingNotFoundError for an unknown finding", async () => {
    const store = new MemoryFindingStatusStore();
    await expect(applyFindingTransition(store, "missing", "Submitted", T)).rejects.toBeInstanceOf(
      FindingNotFoundError,
    );
  });
});
