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
 * (10 MB default), well above the API's 100 KB upload limit. */
export function proxy(request: NextRequest) {
  const target = buildProxyTarget(
    process.env.API_INTERNAL_URL,
    request.nextUrl.pathname,
    request.nextUrl.search,
  );
  if (!target) return NextResponse.next();
  return NextResponse.rewrite(target);
}

export const config = {
  matcher: "/api/:path*",
};
