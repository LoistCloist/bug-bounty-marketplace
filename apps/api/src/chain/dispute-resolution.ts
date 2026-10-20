import type { Address, Hex, PublicClient } from "viem";
import { disputeResolutionAbi } from "@bbm/shared";

export interface OnchainDispute {
  developer: Address;
  auditor: Address;
  /** Unix seconds after which the arbiter's ruling window has closed. */
  ruleBy: bigint;
  resolved: boolean;
}

/** The read-only view of DisputeResolution the API needs. Rulings and
 * disputes are sent by the arbiter and developer in their own wallets, so
 * the API only reads them. */
export interface DisputeResolutionPort {
  getDispute(contractId: Hex, findingId: Hex): Promise<OnchainDispute | null>;
}

export interface DisputeResolutionDeps {
  address: Address;
  publicClient: Pick<PublicClient, "readContract">;
}

export function createDisputeResolutionPort(deps: DisputeResolutionDeps): DisputeResolutionPort {
  const { address, publicClient } = deps;

  return {
    async getDispute(contractId, findingId) {
      const key = (await publicClient.readContract({
        address,
        abi: disputeResolutionAbi,
        functionName: "disputeKey",
        args: [contractId, findingId],
      })) as Hex;

      // The public getter for a struct returns its fields in declaration order.
      const [developer, auditor, ruleBy, resolved] = (await publicClient.readContract({
        address,
        abi: disputeResolutionAbi,
        functionName: "disputes",
        args: [key],
      })) as readonly [Address, Address, bigint, boolean];

      // A dispute that was never opened has a zero developer address.
      if (developer === "0x0000000000000000000000000000000000000000") {
        return null;
      }
      return { developer, auditor, ruleBy, resolved };
    },
  };
}
