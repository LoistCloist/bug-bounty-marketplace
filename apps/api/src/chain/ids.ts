import { keccak256, toBytes, type Hex } from "viem";

/**
 * On-chain contracts key contracts and findings by bytes32. The API keeps
 * readable ids (`contract_<uuid>`), so the on-chain key is the keccak256 of
 * the API id. Deterministic: nothing extra needs storing to map back.
 */
export function onchainId(apiId: string): Hex {
  return keccak256(toBytes(apiId));
}
