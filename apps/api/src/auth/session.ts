import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";

export const SESSION_COOKIE = "bbm_session";
const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 8 * 3_600_000;

/** The exact message a wallet signs to sign in. */
export function signInMessage(address: string, nonce: string): string {
  return `BountyGuard sign-in\nAddress: ${address}\nNonce: ${nonce}`;
}

/**
 * Signed-message sign-in. A nonce is single use and lives 5 minutes; a session
 * is an HMAC-signed cookie (address + expiry) that lives 8 hours. Nonces are
 * held in memory, so sign-in needs a single API replica (as the demo runs).
 */
export class Auth {
  private readonly nonces = new Map<string, { address: Address; expiresAt: number }>();

  constructor(
    private readonly secret: string,
    private readonly now: () => Date,
  ) {}

  issueNonce(address: string): { nonce: string; message: string } {
    const checksummed = getAddress(address);
    this.pruneNonces();
    const nonce = randomBytes(16).toString("hex");
    this.nonces.set(nonce, { address: checksummed, expiresAt: this.now().getTime() + NONCE_TTL_MS });
    return { nonce, message: signInMessage(checksummed, nonce) };
  }

  /** Verifies a signature over an issued nonce's message. Returns the session
   * cookie value on success, null otherwise. The nonce is spent either way. */
  async login(address: string, signature: Hex): Promise<{ address: Address; token: string } | null> {
    if (!isAddress(address)) return null;
    const checksummed = getAddress(address);
    for (const [nonce, entry] of this.nonces) {
      if (entry.address !== checksummed) continue;
      if (entry.expiresAt <= this.now().getTime()) {
        this.nonces.delete(nonce);
        continue;
      }
      const message = signInMessage(checksummed, nonce);
      const valid = await verifyMessage({ address: checksummed, message, signature }).catch(() => false);
      if (!valid) continue;
      this.nonces.delete(nonce);
      return { address: checksummed, token: this.sign(checksummed) };
    }
    return null;
  }

  /** The signed-in address from the request's session cookie, or null. */
  sessionAddress(request: FastifyRequest): Address | null {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) return null;
    const [payload, mac] = token.split(".");
    if (!payload || !mac || !safeEqual(mac, this.mac(payload))) return null;
    const [address, expires] = Buffer.from(payload, "base64url").toString("utf8").split("|");
    if (!address || !isAddress(address) || Number(expires) <= this.now().getTime()) return null;
    return getAddress(address);
  }

  /** The signed-in address, or sends 401 and returns undefined. */
  requireSession(request: FastifyRequest, reply: FastifyReply): Address | undefined {
    const address = this.sessionAddress(request);
    if (!address) {
      void reply.code(401).send({ error: "sign in first" });
      return undefined;
    }
    return address;
  }

  sessionCookie(token: string): string {
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
  }

  static clearedCookie(): string {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  private sign(address: Address): string {
    const payload = Buffer.from(`${address}|${this.now().getTime() + SESSION_TTL_MS}`).toString("base64url");
    return `${payload}.${this.mac(payload)}`;
  }

  private mac(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  private pruneNonces(): void {
    const now = this.now().getTime();
    for (const [nonce, entry] of this.nonces) if (entry.expiresAt <= now) this.nonces.delete(nonce);
  }
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
