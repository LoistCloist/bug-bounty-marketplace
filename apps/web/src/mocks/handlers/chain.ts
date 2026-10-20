import { http, HttpResponse } from "msw";

/** Mock mode has no chain. In live mode this handler is dropped and the real
 * API answers. */
export const chainHandlers = [http.get("*/api/chain", () => HttpResponse.json({ configured: false }))];
