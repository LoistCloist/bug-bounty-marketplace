import { NextResponse, type NextRequest } from "next/server";
import { buildProxyTarget } from "@/lib/proxy-target";

/** Forwards `/api/*` to the real Fastify API when `API_INTERNAL_URL` is set.
 *
 * Proxy runs on the Node.js runtime by default in Next 16, and this file is
 * evaluated per request, so `process.env.API_INTERNAL_URL` is read at
 * request time - one image can be pointed at any API origin via env.
 * (`NEXT_PUBLIC_*` vars, by contrast, are inlined at build time.)
 *
 * `NextResponse.rewrite` to an external origin forwards method, headers and
 * the (buffered) request body, so multipart `.sol` uploads go through
 * intact. Next buffers proxied bodies up to `proxyClientMaxBodySize`
 * (10 MB default), well above the API's 100 KB upload limit.
 *
 * A malformed `API_INTERNAL_URL` answers 500 `{ error: "proxy misconfigured" }`
 * and logs the reason once per process. */
let loggedMisconfiguration = false;

export function proxy(request: NextRequest) {
  let target: string | null;
  try {
    target = buildProxyTarget(
      process.env.API_INTERNAL_URL,
      request.nextUrl.pathname,
      request.nextUrl.search,
    );
  } catch (err) {
    if (!loggedMisconfiguration) {
      loggedMisconfiguration = true;
      console.error(err);
    }
    return NextResponse.json({ error: "proxy misconfigured" }, { status: 500 });
  }
  if (!target) return NextResponse.next();
  return NextResponse.rewrite(target);
}

export const config = {
  matcher: "/api/:path*",
};
