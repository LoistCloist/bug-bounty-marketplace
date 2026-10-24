import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Abi,
  type Address,
  type Hash,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import {
  auditorStakingAbi,
  bountyEscrowAbi,
  disputeResolutionAbi,
  type ChainInfo,
} from "@bbm/shared";
import { onchainId } from "./ids";

export type LocalChainInfo = Extract<ChainInfo, { configured: true }>;

/** A transaction the user signs. */
export interface ContractWrite {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}

/** What chainCalls needs from a chain client; tests pass a fake. */
export interface TxClient {
  /** Throws ChainTxError with the revert reason when the call would revert. */
  simulate(request: ContractWrite): Promise<void>;
  write(request: ContractWrite): Promise<Hash>;
  /** True when the transaction's receipt says it succeeded. */
  waitForSuccess(hash: Hash): Promise<boolean>;
  /** Calls a view function. */
  read(request: Omit<ContractWrite, "value">): Promise<unknown>;
}

/** BountyEscrow.BountyState, in the contract's order. */
const BOUNTY_STATE = { None: 0, Open: 1, Paid: 2, Closed: 3 } as const;

/** A user transaction that reverted or could not be sent. `message` is the
 * contract's error name or viem's short message, for the UI. */
export class ChainTxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainTxError";
  }
}

function reasonOf(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      return revert.data?.errorName ?? revert.reason ?? revert.shortMessage;
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

/** viem clients on the API-described chain, signing with `account`. */
export function viemTxClient(info: LocalChainInfo, account: PrivateKeyAccount): TxClient {
  if (!info.rpcUrl) throw new ChainTxError("the API did not publish a chain RPC URL");
  const chain = defineChain({
    id: info.chainId,
    name: "Local chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [info.rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(info.rpcUrl) });
  const walletClient = createWalletClient({ chain, transport: http(info.rpcUrl), account });
  return {
    async simulate(request) {
      try {
        await publicClient.simulateContract({ ...request, account } as never);
      } catch (err) {
        throw new ChainTxError(reasonOf(err));
      }
    },
    async write(request) {
      try {
        return await walletClient.writeContract({ ...request, account, chain } as never);
      } catch (err) {
        throw new ChainTxError(reasonOf(err));
      }
    },
    async waitForSuccess(hash) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return receipt.status === "success";
    },
    async read(request) {
      return publicClient.readContract(request as never);
    },
  };
}

/**
 * The lifecycle transactions users sign in the browser. Each one first runs
 * `beforeSend` (the caller's check that the API session belongs to this
 * account), is simulated (so a revert shows its reason and nothing is sent),
 * then sent and awaited; it resolves only on a successful receipt. Callers
 * call the matching API route only after it resolves.
 *
 * A step that already happened on-chain (an earlier attempt whose API call
 * failed) resolves null instead of failing, so retrying the flow goes straight
 * on to the API call.
 */
export function chainCalls(
  info: LocalChainInfo,
  account: PrivateKeyAccount,
  client: TxClient = viemTxClient(info, account),
  options: { beforeSend?: () => Promise<void> } = {},
) {
  const auditorStaking = info.addresses.auditorStaking as Address;
  const bountyEscrow = info.addresses.bountyEscrow as Address;
  const disputeResolution = info.addresses.disputeResolution as Address;

  async function bountyState(contractId: string): Promise<number> {
    const bounty = (await client.read({
      address: bountyEscrow,
      abi: bountyEscrowAbi as Abi,
      functionName: "bounties",
      args: [onchainId(contractId)],
    })) as readonly unknown[];
    return Number(bounty[3]);
  }

  /** Sends `request`. When the simulation reverts with one of `doneErrors`
   * and `isDone` (if given) confirms it, the step already happened: null. */
  async function send(
    request: ContractWrite,
    doneErrors: readonly string[] = [],
    isDone: () => Promise<boolean> = async () => true,
  ): Promise<Hash | null> {
    await options.beforeSend?.();
    try {
      await client.simulate(request);
    } catch (err) {
      if (err instanceof ChainTxError && doneErrors.includes(err.message) && (await isDone()))
        return null;
      throw err;
    }
    const hash = await client.write(request);
    if (!(await client.waitForSuccess(hash))) throw new ChainTxError("transaction reverted");
    return hash;
  }

  const closed = (contractId: string) => async () =>
    (await bountyState(contractId)) === BOUNTY_STATE.Closed;

  return {
    fundBounty: (contractId: string, deadline: Date, amountWei: string) =>
      send(
        {
          address: bountyEscrow,
          abi: bountyEscrowAbi as Abi,
          functionName: "fund",
          args: [onchainId(contractId), BigInt(Math.floor(deadline.getTime() / 1000))],
          value: BigInt(amountWei),
        },
        ["BountyExists"],
      ),
    /** True once the contract's bounty exists on-chain. */
    isFunded: async (contractId: string) => (await bountyState(contractId)) !== BOUNTY_STATE.None,
    stake: (amountWei: string) =>
      send({
        address: auditorStaking,
        abi: auditorStakingAbi as Abi,
        functionName: "stake",
        args: [],
        value: BigInt(amountWei),
      }),
    openDispute: (contractId: string, findingId: string, reason: string) =>
      send(
        {
          address: disputeResolution,
          abi: disputeResolutionAbi as Abi,
          functionName: "openDispute",
          args: [onchainId(contractId), onchainId(findingId), reason],
        },
        ["DisputeExists"],
      ),
    rule: (contractId: string, findingId: string, auditorWon: boolean) =>
      send(
        {
          address: disputeResolution,
          abi: disputeResolutionAbi as Abi,
          functionName: "rule",
          args: [onchainId(contractId), onchainId(findingId), auditorWon],
        },
        ["AlreadyResolved"],
      ),
    deleteBounty: (contractId: string) =>
      send(
        {
          address: bountyEscrow,
          abi: bountyEscrowAbi as Abi,
          functionName: "deleteBounty",
          args: [onchainId(contractId)],
        },
        ["BountyNotOpen"],
        closed(contractId),
      ),
    refund: (contractId: string) =>
      send(
        {
          address: bountyEscrow,
          abi: bountyEscrowAbi as Abi,
          functionName: "refund",
          args: [onchainId(contractId)],
        },
        ["BountyNotOpen"],
        closed(contractId),
      ),
    withdrawPayout: () =>
      send({
        address: bountyEscrow,
        abi: bountyEscrowAbi as Abi,
        functionName: "withdrawPayout",
        args: [],
      }),
  };
}

export type ChainCalls = ReturnType<typeof chainCalls>;
