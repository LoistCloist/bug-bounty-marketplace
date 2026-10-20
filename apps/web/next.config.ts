import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // The repo already has a root CLAUDE.md; don't let Next.js generate
  // a second, conflicting one (or AGENTS.md) inside apps/web.
  agentRules: false,
  // MSW's browser export is intentionally unavailable under Node conditions.
  // The provider is client-only, so exclude that entry from the server bundle.
  webpack(config, { isServer }) {
    if (isServer) config.resolve.alias["msw/browser"] = false;
    return config;
  },
};

export default nextConfig;
