import type { Account, Address, Chain, Hash, PublicClient, Transport, WalletClient } from "viem";
import { auditorStakingAbi } from "@bbm/shared";

/** The operator-side view of AuditorStaking the API needs. */
export interface AuditorStakingPort {
  stakeOf(auditor: Address): Promise<bigint>;
  activeSubmissions(auditor: Address): Promise<bigint>;
  lockSubmission(auditor: Address): Promise<Hash>;
  unlockSubmission(auditor: Address): Promise<Hash>;
}

export interface AuditorStakingDeps {
  address: Address;
  publicClient: Pick<PublicClient, "readContract" | "waitForTransactionReceipt">;
  /** Must be created with the operator account, since lock/unlock are operator-only. */
  walletClient: Pick<WalletClient<Transport, Chain | undefined, Account>, "writeContract">;
}

export function createAuditorStakingPort(deps: AuditorStakingDeps): AuditorStakingPort {
  const { address, publicClient, walletClient } = deps;

  async function send(functionName: "lockSubmission" | "unlockSubmission", auditor: Address): Promise<Hash> {
    const hash = await walletClient.writeContract({
      address,
      abi: auditorStakingAbi,
      functionName,
      args: [auditor],
      chain: undefined,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`AuditorStaking.${functionName} reverted in ${hash}`);
    }
    return hash;
  }

  return {
    stakeOf: (auditor) =>
      publicClient.readContract({
        address,
        abi: auditorStakingAbi,
        functionName: "stakeOf",
        args: [auditor],
      }) as Promise<bigint>,
    activeSubmissions: (auditor) =>
      publicClient.readContract({
        address,
        abi: auditorStakingAbi,
        functionName: "activeSubmissions",
        args: [auditor],
      }) as Promise<bigint>,
    lockSubmission: (auditor) => send("lockSubmission", auditor),
    unlockSubmission: (auditor) => send("unlockSubmission", auditor),
  };
}
