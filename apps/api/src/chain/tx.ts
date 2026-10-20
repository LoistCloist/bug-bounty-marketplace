import type { Hash, PublicClient } from "viem";

/**
 * Waits for a sent transaction to be mined and throws if it reverted, so a
 * failed on-chain action never looks like a success to the API.
 */
export async function awaitSuccess(
  publicClient: Pick<PublicClient, "waitForTransactionReceipt">,
  hash: Hash,
  label: string,
): Promise<Hash> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`${label} reverted in ${hash}`);
  }
  return hash;
}
