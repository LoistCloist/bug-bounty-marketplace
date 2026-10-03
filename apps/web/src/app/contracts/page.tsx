"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { developerApi, ApiError } from "@/lib/api";
import { useWallet } from "@/lib/wallet";

export default function ContractsPage() {
  const wallet = useWallet();

  const contractsQuery = useQuery({
    queryKey: ["contracts", wallet.address],
    queryFn: () => developerApi.listContracts({ developerAddress: wallet.address ?? undefined }),
    enabled: Boolean(wallet.address),
  });

  if (!wallet.address) {
    return <p className="text-slate-400">Connect a wallet to see your contracts.</p>;
  }

  if (contractsQuery.isLoading) {
    return <p className="text-slate-400">Loading contracts...</p>;
  }

  if (contractsQuery.isError) {
    const message =
      contractsQuery.error instanceof ApiError
        ? contractsQuery.error.message
        : "Failed to load contracts.";
    return <p className="text-red-400">{message}</p>;
  }

  const contracts = contractsQuery.data ?? [];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Your contracts</h1>
      {contracts.length === 0 ? (
        <p className="mt-4 text-slate-400">
          You haven&apos;t submitted any contracts yet. <Link href="/submit" className="text-emerald-400 hover:text-emerald-300">Submit one</Link>.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {contracts.map((contract) => (
            <li key={contract.id}>
              <Link
                href={`/contracts/${contract.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 hover:border-slate-600"
              >
                <div>
                  <p className="font-medium text-white">{contract.filename}</p>
                  <p className="text-xs text-slate-500">
                    Created {new Date(contract.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className="text-sm text-slate-300">{contract.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
