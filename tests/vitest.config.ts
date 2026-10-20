import { defineConfig } from "vitest/config";

const project = (name: string) => ({
  test: {
    name,
    include: [`${name}/**/*.test.ts`],
    globalSetup: ["./lib/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

// Each tier is a separate project so CI can run them independently:
//   pnpm test:integration | test:regression | test:smoke
export default defineConfig({
  test: {
    projects: [project("integration"), project("regression"), project("smoke")],
  },
});
