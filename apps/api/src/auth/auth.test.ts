import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { buildApp } from "../app.js";

const AUDITOR = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const DEVELOPER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const SECRET = "test-session-secret";

function setup() {
  const clock = { now: new Date("2026-10-20T12:00:00.000Z") };
  const app = buildApp({ sessionSecret: SECRET, now: () => clock.now });
  async function nonce(address: string) {
    const res = await app.inject({ method: "POST", url: "/api/auth/nonce", payload: { address } });
    expect(res.statusCode).toBe(200);
    return res.json() as { nonce: string; message: string };
  }
  async function login(address: string, signature: string) {
    return app.inject({ method: "POST", url: "/api/auth/login", payload: { address, signature } });
  }
  function cookieOf(res: { headers: Record<string, unknown> }): string {
    const raw = String(res.headers["set-cookie"]);
    return raw.split(";")[0]!;
  }
  return { app, clock, nonce, login, cookieOf };
}

describe("signed-message sign-in", () => {
  it("issues a message naming the address and nonce", async () => {
    const { nonce } = setup();
    const { nonce: n, message } = await nonce(AUDITOR.address);
    expect(message).toBe(`BountyGuard sign-in\nAddress: ${AUDITOR.address}\nNonce: ${n}`);
  });

  it("signs in with a valid signature and /me returns the address", async () => {
    const { app, nonce, login, cookieOf } = setup();
    const { message } = await nonce(AUDITOR.address);
    const res = await login(AUDITOR.address, await AUDITOR.signMessage({ message }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ address: AUDITOR.address });
    expect(String(res.headers["set-cookie"])).toMatch(/bbm_session=.*HttpOnly/i);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: cookieOf(res) } });
    expect(me.json()).toEqual({ address: AUDITOR.address });
  });

  it("rejects a signature from another account", async () => {
    const { nonce, login } = setup();
    const { message } = await nonce(AUDITOR.address);
    const res = await login(AUDITOR.address, await DEVELOPER.signMessage({ message }));
    expect(res.statusCode).toBe(401);
  });

  it("rejects a reused nonce", async () => {
    const { nonce, login } = setup();
    const { message } = await nonce(AUDITOR.address);
    const signature = await AUDITOR.signMessage({ message });
    expect((await login(AUDITOR.address, signature)).statusCode).toBe(200);
    expect((await login(AUDITOR.address, signature)).statusCode).toBe(401);
  });

  it("rejects an expired nonce", async () => {
    const { clock, nonce, login } = setup();
    const { message } = await nonce(AUDITOR.address);
    clock.now = new Date(clock.now.getTime() + 6 * 60_000);
    expect((await login(AUDITOR.address, await AUDITOR.signMessage({ message }))).statusCode).toBe(401);
  });

  it("rejects a tampered or expired session cookie", async () => {
    const { app, clock, nonce, login, cookieOf } = setup();
    const { message } = await nonce(AUDITOR.address);
    const cookie = cookieOf(await login(AUDITOR.address, await AUDITOR.signMessage({ message })));
    const tampered = cookie.slice(0, -2) + (cookie.endsWith("aa") ? "bb" : "aa");
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: tampered } })).statusCode).toBe(401);
    clock.now = new Date(clock.now.getTime() + 9 * 3_600_000);
    expect((await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("logs out by clearing the cookie", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "POST", url: "/api/auth/logout" });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["set-cookie"])).toMatch(/bbm_session=;.*Max-Age=0/i);
  });
});
