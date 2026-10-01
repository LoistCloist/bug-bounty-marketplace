import { HttpResponse } from "msw";
import { MockApiError } from "../db/errors";

/** Maps a thrown mock-DB error to the matching HTTP JSON error response. */
export function errorResponse(err: unknown): Response {
  if (err instanceof MockApiError) {
    return HttpResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[mocks] unexpected handler error:", err);
  return HttpResponse.json({ error: "Internal mock error" }, { status: 500 });
}
