import { describe, expect, it } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { ANVIL_ACCOUNTS } from "@/lib/chain/accounts";
import { ensureSignedIn, signIn } from "../auth";

/** Fake API sign-in: records each completed login and, like the real API,
 * remembers the last one as the session. */
function fakeAuth(options: { slowFor?: string } = {}) {
  const state = { logins: [] as string[], session: null as string | null };
  server.use(
    http.post("*/api/auth/nonce", async ({ request }) => {
      const { address } = (await request.json()) as { address: string };
      return HttpResponse.json({ nonce: "n", message: `sign in ${address}` });
    }),
    http.post("*/api/auth/login", async ({ request }) => {
      const { address } = (await request.json()) as { address: string };
      if (address === options.slowFor) await delay(80);
      state.logins.push(address);
      state.session = address;
      return HttpResponse.json({ address });
    }),
    http.get("*/api/auth/me", () =>
      state.session
        ? HttpResponse.json({ address: state.session })
        : HttpResponse.json({ error: "sign in" }, { status: 401 }),
    ),
  );
  return state;
}

describe("signIn", () => {
  it("runs one sign-in at a time, so the last one requested owns the session", async () => {
    const state = fakeAuth({ slowFor: ANVIL_ACCOUNTS.developer.address });
    await Promise.all([signIn(ANVIL_ACCOUNTS.developer), signIn(ANVIL_ACCOUNTS.auditor)]);
    expect(state.logins).toEqual([
      ANVIL_ACCOUNTS.developer.address,
      ANVIL_ACCOUNTS.auditor.address,
    ]);
    expect(state.session).toBe(ANVIL_ACCOUNTS.auditor.address);
  });
});

describe("ensureSignedIn", () => {
  it("does nothing when the session is already this account's", async () => {
    const state = fakeAuth();
    state.session = ANVIL_ACCOUNTS.auditor.address.toLowerCase();
    await ensureSignedIn(ANVIL_ACCOUNTS.auditor);
    expect(state.logins).toEqual([]);
  });

  it("signs in when there is no session or it belongs to another account", async () => {
    const state = fakeAuth();
    await ensureSignedIn(ANVIL_ACCOUNTS.auditor);
    state.session = ANVIL_ACCOUNTS.developer.address;
    await ensureSignedIn(ANVIL_ACCOUNTS.auditor);
    expect(state.logins).toEqual([ANVIL_ACCOUNTS.auditor.address, ANVIL_ACCOUNTS.auditor.address]);
    expect(state.session).toBe(ANVIL_ACCOUNTS.auditor.address);
  });
});
