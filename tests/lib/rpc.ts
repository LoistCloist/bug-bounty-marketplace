import { env } from "./env.js";

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

let nextId = 1;

/** Minimal JSON-RPC client over plain fetch (no viem/ethers dependency).
 * Throws on transport errors and on a JSON-RPC `error` member. */
export async function rpc<T = string>(
  method: string,
  params: unknown[] = [],
  url: string = env.rpcUrl,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = (await res.json()) as JsonRpcResponse<T>;
  if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  return body.result as T;
}

/** Decodes an ABI-encoded `address` return value (32-byte word) into a
 * lowercase 0x address. */
export function decodeAddress(word: string): string {
  const hex = word.replace(/^0x/, "");
  if (hex.length !== 64) throw new Error(`expected a 32-byte word, got ${word}`);
  return `0x${hex.slice(24)}`.toLowerCase();
}
