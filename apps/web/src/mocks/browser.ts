import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

/** Browser MSW worker. Started conditionally (see src/app/providers.tsx)
 * when NEXT_PUBLIC_API_MOCKING=enabled. */
export const worker = setupWorker(...handlers);
