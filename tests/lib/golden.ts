/** Helpers for golden-file (snapshot) regression tests. */

/** Recursively sorts object keys so a golden only changes when the payload
 * does, never because the server reordered its properties. Arrays keep their
 * order: element order is part of the contract (e.g. validation `issues`). */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** Deterministic JSON for goldens: sorted keys, 2-space indent, trailing
 * newline. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

/** Replaces every occurrence of each `volatile` string (anywhere inside any
 * string in `value`, so ids embedded in other fields such as
 * `sourceReference` are caught too) with its placeholder. */
export function redact(value: unknown, volatile: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const [needle, placeholder] of volatile) out = out.split(needle).join(placeholder);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, volatile));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v, volatile)]),
    );
  }
  return value;
}
