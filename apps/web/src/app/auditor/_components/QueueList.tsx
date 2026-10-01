"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { auditorApi, ApiError, type QueueItem } from "@/lib/api";

type SortOption = "newest" | "deadline" | "bounty";

const SORT_LABELS: Record<SortOption, string> = {
  newest: "Newest",
  deadline: "Deadline",
  bounty: "Bounty size",
};

export function QueueList({ auditorId }: { auditorId: string }) {
  const [sort, setSort] = useState<SortOption>("newest");
  const [claimError, setClaimError] = useState<string | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  const queueQuery = useQuery({
    queryKey: ["auditor-queue", sort],
    queryFn: () => auditorApi.listQueue({ sort }),
  });

  const claimMutation = useMutation({
    mutationFn: (contractId: string) => auditorApi.claimContract({ contractId, auditorId }),
    onSuccess: (contract) => {
      setClaimError(null);
      void queryClient.invalidateQueries({ queryKey: ["auditor-queue"] });
      router.push(`/auditor/contracts/${contract.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setClaimError("Someone else already claimed that contract. Refreshing the queue.");
        void queryClient.invalidateQueries({ queryKey: ["auditor-queue"] });
        return;
      }
      setClaimError(err instanceof ApiError ? err.message : "Failed to claim contract.");
    },
  });

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Open queue</h2>
        <div className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 p-1">
          {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSort(option)}
              aria-pressed={sort === option}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                sort === option
                  ? "bg-emerald-500 text-slate-950"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`}
            >
              {SORT_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      {claimError && <p className="mt-3 text-sm text-red-400">{claimError}</p>}

      {queueQuery.isLoading && <p className="mt-4 text-slate-400">Loading queue...</p>}
      {queueQuery.isError && <p className="mt-4 text-red-400">Failed to load the queue.</p>}

      {queueQuery.data && queueQuery.data.length === 0 && (
        <p className="mt-4 text-slate-400">No open contracts right now.</p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {queueQuery.data?.map((item: QueueItem) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
          >
            <div>
              <p className="font-medium text-white">{item.filename}</p>
              <p className="text-sm text-slate-400">
                {item.bounty.amount} {item.bounty.currency} - deadline{" "}
                {new Date(item.deadline).toLocaleDateString()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setClaimError(null);
                claimMutation.mutate(item.id);
              }}
              disabled={claimMutation.isPending}
              className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {claimMutation.isPending && claimMutation.variables === item.id
                ? "Claiming..."
                : "Claim"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
