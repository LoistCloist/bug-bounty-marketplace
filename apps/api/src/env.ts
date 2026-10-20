import path from "node:path";
import { fileURLToPath } from "node:url";

/** Parses a boolean env var. Unset or empty yields `fallback`; "false", "0",
 * "no" and "off" (any case) yield false; anything else yields true. */
export function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}

/** Parses a positive integer env var, falling back when unset or invalid. */
export function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Resolves the migrations directory: `MIGRATIONS_DIR` when set, otherwise a
 * `migrations` dir next to the running module. Under tsx that module is
 * src/db/migrate.ts (→ src/db/migrations); in the esbuild bundle it is
 * dist/index.js or dist/migrate-cli.js (→ dist/migrations). */
export function resolveMigrationsDir(envDir: string | undefined, moduleUrl: string): string {
  if (envDir && envDir.trim() !== "") return path.resolve(envDir);
  return path.join(path.dirname(fileURLToPath(moduleUrl)), "migrations");
}
