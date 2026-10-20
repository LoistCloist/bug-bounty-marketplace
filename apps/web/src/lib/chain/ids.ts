import { keccak256, toBytes, type Hex } from "viem";

/** The bytes32 id the contracts use for an API id (contract_…, finding_…).
 * Same derivation as the API's chain/ids.ts. */
export function onchainId(apiId: string): Hex {
  return keccak256(toBytes(apiId));
}
