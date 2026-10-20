/** Builds the upstream URL that an incoming `/api/...` request should be
 * forwarded to, or `null` when no upstream is configured (so the request
 * passes through untouched - e.g. local dev where MSW's browser worker
 * answers `/api/*` before it ever reaches the Next server).
 *
 * Throws when the upstream is set but is not an absolute http(s) URL (e.g.
 * `api:3001` without a scheme), so misconfiguration is loud rather than
 * silently rewriting to a bogus target.
 *
 * Pure so it can be unit-tested without Next's request objects. */
export function buildProxyTarget(
  apiInternalUrl: string | undefined,
  pathname: string,
  search: string,
): string | null {
  const base = apiInternalUrl?.trim().replace(/\/+$/, "");
  if (!base) return null;
  let protocol: string;
  try {
    protocol = new URL(base).protocol;
  } catch {
    protocol = "";
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`API_INTERNAL_URL must be an absolute http(s) URL, got ${JSON.stringify(base)}`);
  }
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const query = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `${base}${path}${query}`;
}
