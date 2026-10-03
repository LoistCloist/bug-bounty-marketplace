import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/** Node MSW server used in Vitest. See src/test/setup.ts for lifecycle. */
export const server = setupServer(...handlers);
