import { useQuery } from "@tanstack/react-query";
import type { ChainInfo } from "@bbm/shared";
import { getChainInfo } from "@/lib/api/chain";
import { LOCAL_CHAIN_ID } from "./accounts";
import type { LocalChainInfo } from "./calls";

/** The API's chain description; fetched once per session. */
export function useChainInfo(): ChainInfo | undefined {
  return useQuery({ queryKey: ["chain"], queryFn: getChainInfo, staleTime: Infinity, retry: false }).data;
}

/** True when the API runs on the local anvil chain the demo accounts live on,
 * with an RPC URL the browser can use. */
export function isLocalChain(info: ChainInfo | undefined): info is LocalChainInfo {
  return info?.configured === true && info.chainId === LOCAL_CHAIN_ID && Boolean(info.rpcUrl);
}
