import { z } from "zod";
import type { PrivateKeyAccount } from "viem/accounts";
import { postJson } from "./http";

const NonceSchema = z.object({ nonce: z.string(), message: z.string() });
const SessionSchema = z.object({ address: z.string() });

/** Signs in with the API's signed-message sign-in; the API sets a session
 * cookie that every later request carries. */
export async function signIn(account: PrivateKeyAccount): Promise<string> {
  const { message } = await postJson("/api/auth/nonce", { address: account.address }, NonceSchema);
  const signature = await account.signMessage({ message });
  const session = await postJson("/api/auth/login", { address: account.address, signature }, SessionSchema);
  return session.address;
}
