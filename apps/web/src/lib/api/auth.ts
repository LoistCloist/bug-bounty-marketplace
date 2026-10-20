import { z } from "zod";
import type { PrivateKeyAccount } from "viem/accounts";
import { ApiError, getJson, postJson } from "./http";

const NonceSchema = z.object({ nonce: z.string(), message: z.string() });
const SessionSchema = z.object({ address: z.string() });

// The session is one cookie, so sign-ins run one at a time: the last one
// requested is the last one to set it.
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function login(account: PrivateKeyAccount): Promise<string> {
  const { message } = await postJson("/api/auth/nonce", { address: account.address }, NonceSchema);
  const signature = await account.signMessage({ message });
  const session = await postJson(
    "/api/auth/login",
    { address: account.address, signature },
    SessionSchema,
  );
  return session.address;
}

/** Signs in with the API's signed-message sign-in; the API sets a session
 * cookie that every later request carries. */
export function signIn(account: PrivateKeyAccount): Promise<string> {
  return serialized(() => login(account));
}

/** Makes sure the API session belongs to `account`, signing in again if it
 * is missing or belongs to another account (another role, or another tab). */
export function ensureSignedIn(account: PrivateKeyAccount): Promise<void> {
  return serialized(async () => {
    try {
      const { address } = await getJson("/api/auth/me", SessionSchema);
      if (address.toLowerCase() === account.address.toLowerCase()) return;
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    }
    await login(account);
  });
}
