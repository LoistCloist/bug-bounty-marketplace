import { ChainInfoSchema, type ChainInfo } from "@bbm/shared";
import { getJson } from "./http";

/** GET /api/chain - whether the API runs against a chain, and what the
 * browser needs to sign transactions on it. */
export function getChainInfo(): Promise<ChainInfo> {
  return getJson("/api/chain", ChainInfoSchema);
}
