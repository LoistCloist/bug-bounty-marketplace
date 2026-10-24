import type { FastifyInstance } from "fastify";
import { isAddress, isHex } from "viem";
import { Auth } from "./session.js";

export function registerAuthRoutes(app: FastifyInstance, auth: Auth): void {
  app.post<{ Body: { address?: unknown } | undefined }>("/api/auth/nonce", async (request, reply) => {
    const address = request.body?.address;
    if (typeof address !== "string" || !isAddress(address)) {
      return reply.code(400).send({ error: "address must be a 0x address" });
    }
    return auth.issueNonce(address);
  });

  app.post<{ Body: { address?: unknown; signature?: unknown } | undefined }>(
    "/api/auth/login",
    async (request, reply) => {
      const { address, signature } = request.body ?? {};
      if (typeof address !== "string" || typeof signature !== "string" || !isHex(signature)) {
        return reply.code(400).send({ error: "address and signature are required" });
      }
      const session = await auth.login(address, signature);
      if (!session) return reply.code(401).send({ error: "signature does not match an open sign-in request" });
      void reply.header("set-cookie", auth.sessionCookie(session.token));
      return { address: session.address };
    },
  );

  app.get("/api/auth/me", async (request, reply) => {
    const address = auth.requireSession(request, reply);
    if (!address) return reply;
    return { address };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    void reply.header("set-cookie", Auth.clearedCookie());
    return { ok: true };
  });
}
