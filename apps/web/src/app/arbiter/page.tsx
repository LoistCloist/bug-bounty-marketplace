"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { arbiterApi, ApiError } from "@/lib/api";
import { useWallet } from "@/lib/wallet";
import { DisputeCard } from "./_components/DisputeCard";

type Tab = "Pending" | "ForAuditor" | "AgainstAuditor" | "All";

const TABS: { id: Tab; label: string }[] = [
  { id: "Pending", label: "Open" },
  { id: "ForAuditor", label: "Ruled for auditor" },
  { id: "AgainstAuditor", label: "Ruled against auditor" },
  { id: "All", label: "All" },
];

const FALLBACK_ARBITER_ID = "arbiter_1";

export default function ArbiterPage() {
  const [tab, setTab] = useState<Tab>("Pending");
  const [notice, setNotice] = useState<string | null>(null);
  const wallet = useWallet();
  const arbiterId = wallet.address ?? FALLBACK_ARBITER_ID;
  const queryClient = useQueryClient();

  const filter = tab === "All" ? undefined : { ruling: tab };
  const queryKey = ["arbiter", "disputes", tab] as const;

  const disputesQuery = useQuery({
    queryKey,
    queryFn: () => arbiterApi.listDisputes(filter),
  });

  const ruleMutation = useMutation({
    mutationFn: (input: { disputeId: string; ruling: "ForAuditor" | "AgainstAuditor" }) =>
      arbiterApi.ruleOnDispute(input.disputeId, { arbiterId, ruling: input.ruling }),
    onSuccess: () => {
      setNotice(null);
      void queryClient.invalidateQueries({ queryKey: ["arbiter", "disputes"] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        setNotice("Someone else already ruled on this dispute. Refreshing the list.");
      } else {
        setNotice(err instanceof Error ? err.message : "Failed to submit ruling.");
      }
      void queryClient.invalidateQueries({ queryKey: ["arbiter", "disputes"] });
    },
  });

  function handleRule(disputeId: string, ruling: "ForAuditor" | "AgainstAuditor") {
    const verb = ruling === "ForAuditor" ? "FOR the auditor (pays out)" : "AGAINST the auditor (rejects + slashes stake)";
    const confirmed = window.confirm(`Rule ${verb} on dispute ${disputeId}? This cannot be undone.`);
    if (!confirmed) return;
    ruleMutation.mutate({ disputeId, ruling });
  }

  const disputes = disputesQuery.data ?? [];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Open disputes</h1>
      <p className="mt-2 text-slate-400">
        Review the developer&apos;s challenge against the auditor&apos;s original finding and
        sandbox-verified PoC, then rule for or against the auditor.
      </p>

      <div className="mt-6 flex flex-wrap gap-1 rounded-full border border-slate-700 bg-slate-900 p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-emerald-500 text-slate-950"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {notice ? (
        <div className="mt-4 rounded-md border border-amber-700 bg-amber-900/30 px-4 py-2 text-sm text-amber-200">
          {notice}
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        {disputesQuery.isLoading ? <p className="text-slate-400">Loading disputes…</p> : null}

        {disputesQuery.isError ? (
          <p className="text-red-400">Failed to load disputes.</p>
        ) : null}

        {!disputesQuery.isLoading && !disputesQuery.isError && disputes.length === 0 ? (
          <p className="text-slate-400">
            {tab === "Pending"
              ? "No open disputes right now."
              : "No disputes match this filter."}
          </p>
        ) : null}

        {disputes.map((dispute) => (
          <DisputeCard
            key={dispute.id}
            dispute={dispute}
            onRule={(ruling) => handleRule(dispute.id, ruling)}
            isRuling={ruleMutation.isPending && ruleMutation.variables?.disputeId === dispute.id}
          />
        ))}
      </div>
    </div>
  );
}
