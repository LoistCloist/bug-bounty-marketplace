import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "@/mocks/server";
import { cancelAllScheduled } from "@/mocks/db";

// Standard MSW + Vitest lifecycle: one Node server for the whole run,
// handlers reset between tests, and every mock-DB timer cancelled at the
// very end so nothing leaks across test files.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  cancelAllScheduled();
});
