import { env } from "./env.js";

/** Fail fast with a clear message when the stack isn't up, instead of every
 * test timing out with ECONNREFUSED. */
export default async function globalSetup(): Promise<void> {
  const url = `${env.apiUrl}/health`;
  const deadline = Date.now() + Number(process.env.BBM_WAIT_MS ?? 30_000);
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(
    `System under test is not reachable at ${url} (${String(lastError)}). ` +
      "Start it with `pnpm stack:up` or set BBM_API_URL/BBM_WEB_URL.",
  );
}
