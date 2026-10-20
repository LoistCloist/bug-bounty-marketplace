import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The repo already has a root CLAUDE.md; don't let Next.js generate
  // a second, conflicting one (or AGENTS.md) inside apps/web.
  agentRules: false,
  // Emit a self-contained server (`.next/standalone`) for the container
  // image - only the traced node_modules are copied, not the whole store.
  output: "standalone",
  // pnpm monorepo: trace files from the repo root so hoisted/symlinked
  // workspace deps (e.g. @bbm/shared, the .pnpm store) land in the
  // standalone bundle. The server ends up at
  // `.next/standalone/apps/web/server.js`.
  outputFileTracingRoot: path.join(here, "../.."),
  // @bbm/shared exports raw TypeScript; let Next compile it.
  transpilePackages: ["@bbm/shared"],
};

export default nextConfig;
