// Liveness probe for the container. Lives outside `/api` so the proxy
// never forwards it to the backend.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
