/** Builds the upstream URL that an incoming `/api/...` request should be
 * forwarded to, or `null` when no upstream is configured (so the request
 * passes through untouched - e.g. local dev where MSW's browser worker
 * answers `/api/*` before it ever reaches the Next server).
 *
 * Pure so it can be unit-tested without Next's request objects. */
export function buildProxyTarget(
  apiInternalUrl: string | undefined,
  pathname: string,
  search: string,
): string | null {
  const base = apiInternalUrl?.trim().replace(/\/+$/, "");
  if (!base) return null;
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const query = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";
  return `${base}${path}${query}`;
}
