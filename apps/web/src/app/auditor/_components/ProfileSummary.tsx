"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { auditorApi, developerApi } from "@/lib/api";
import { StakeGate } from "./StakeGate";

export function ProfileSummary({ auditorId }: { auditorId: string }) {
  const queryClient = useQueryClient();
  const contractsQuery = useQuery({
    queryKey: ["auditor-contracts"],
    queryFn: () => developerApi.listContracts(),
    refetchInterval: 3000,
  });
  const profileQuery = useQuery({
    queryKey: ["auditor-profile", auditorId],
    queryFn: () => auditorApi.getProfile(auditorId),
    refetchInterval: 3000,
  });

  if (profileQuery.isLoading) {
    return <p className="text-slate-400">Loading profile...</p>;
  }
  if (profileQuery.isError || !profileQuery.data) {
    return <p className="text-red-400">Failed to load auditor profile.</p>;
  }

  const profile = profileQuery.data;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-400">Stake</p>
            <p className="text-lg font-semibold text-white">{profile.stake.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-slate-400">Reputation</p>
            <p className="text-lg font-semibold text-white">{profile.reputation}</p>
          </div>
          <div>
            <p className="text-sm text-slate-400">Claimed contracts</p>
            {profile.claimedContractIds.length === 0 ? (
              <p className="text-slate-400">None yet</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {profile.claimedContractIds.map((id) => (
                  <li key={id}>
                    <Link
                      href={`/auditor/contracts/${id}`}
                      className="rounded border border-slate-700 px-2 py-0.5 text-sm text-emerald-400 hover:border-emerald-500"
                    >
                      {contractsQuery.data?.find((c) => c.id === id)?.filename ?? id}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
      <StakeGate
        profile={profile}
        auditorId={auditorId}
        onStaked={() =>
          void queryClient.invalidateQueries({ queryKey: ["auditor-profile", auditorId] })
        }
      />
    </div>
  );
}
