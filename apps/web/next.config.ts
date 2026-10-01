import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The repo already has a root CLAUDE.md; don't let Next.js generate
  // a second, conflicting one (or AGENTS.md) inside apps/web.
  agentRules: false,
};

export default nextConfig;
