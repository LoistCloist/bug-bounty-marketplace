import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Default (classic) JSX transform requires `React` in scope in every file
  // that uses JSX; Next's own SWC build already uses the automatic runtime,
  // so match it here rather than making every RTL test import React by hand.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    // Node by default (fetch/FormData/File need to be Node's own
    // implementations for MSW's node interceptor to parse request bodies
    // correctly). Component tests that need the DOM can opt into jsdom
    // per-file with a `// @vitest-environment jsdom` docblock.
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
