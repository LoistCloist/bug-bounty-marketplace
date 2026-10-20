import { describe, expect, it } from "vitest";
import { developerHandlers } from "./developer";
import { auditorHandlers } from "./auditor";
import { arbiterHandlers } from "./arbiter";
import { LIVE_ROUTES, selectHandlers } from "./live";

const all = [...developerHandlers, ...auditorHandlers, ...arbiterHandlers];

function routes(handlers: typeof all): string[] {
  return handlers.map((h) => `${String(h.info.method)} ${String(h.info.path)}`);
}

describe("selectHandlers", () => {
  it("keeps every mock handler when live mode is off", () => {
    expect(selectHandlers(all, false)).toEqual(all);
  });

  it("drops exactly the live pipeline routes when live mode is on", () => {
    const kept = routes(selectHandlers(all, true));
    const dropped = routes(all).filter((r) => !kept.includes(r));
    expect(dropped.sort()).toEqual(
      [
        "POST */api/contracts",
        "GET */api/contracts",
        "GET */api/contracts/:id",
        "GET */api/contracts/:id/findings",
        "GET */api/contracts/:id/analysis",
        "GET */api/auditor/queue",
        "POST */api/auditor/claim",
        "POST */api/auditor/poc",
      ].sort(),
    );
  });

  it("still mocks stake, profile, disputes and the arbiter", () => {
    const kept = routes(selectHandlers(all, true));
    expect(kept).toContain("POST */api/auditor/stake");
    expect(kept).toContain("GET */api/auditor/profile");
    expect(kept).toContain("POST */api/findings/:id/dispute");
    expect(kept).toContain("GET */api/arbiter/disputes");
  });

  it("lists the raw-output route as live even though it has no mock", () => {
    expect(LIVE_ROUTES).toContainEqual({ method: "GET", path: "/api/findings/:id/raw" });
    expect(LIVE_ROUTES).toHaveLength(9);
  });
});
