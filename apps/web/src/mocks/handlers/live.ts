import type { RequestHandler } from "msw";

/**
 * Routes served by the real API in live pipeline mode
 * (NEXT_PUBLIC_LIVE_PIPELINE=enabled together with NEXT_PUBLIC_API_MOCKING).
 * Their MSW handlers are dropped, so the request reaches the Next server,
 * whose /api proxy (src/proxy.ts, API_INTERNAL_URL) forwards it to the
 * Fastify API. Everything else (stake, profile, disputes, arbiter, ...) stays
 * mocked.
 */
export const LIVE_ROUTES: ReadonlyArray<{ method: "GET" | "POST"; path: string }> = [
  { method: "POST", path: "/api/contracts" },
  { method: "GET", path: "/api/contracts" },
  { method: "GET", path: "/api/contracts/:id" },
  { method: "GET", path: "/api/contracts/:id/findings" },
  { method: "GET", path: "/api/contracts/:id/analysis" },
  { method: "GET", path: "/api/findings/:id/raw" },
  { method: "GET", path: "/api/auditor/queue" },
  { method: "POST", path: "/api/auditor/claim" },
  { method: "POST", path: "/api/auditor/poc" },
];

function isLive(handler: RequestHandler): boolean {
  const info = handler.info as { method?: unknown; path?: unknown };
  const path = String(info.path ?? "").replace(/^\*/, "");
  return LIVE_ROUTES.some((route) => route.method === info.method && route.path === path);
}

/** All handlers when `live` is false; otherwise all but the live routes. */
export function selectHandlers<H extends RequestHandler>(handlers: H[], live: boolean): H[] {
  return live ? handlers.filter((handler) => !isLive(handler)) : handlers;
}
