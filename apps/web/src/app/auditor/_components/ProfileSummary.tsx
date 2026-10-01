"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { auditorApi } from "@/lib/api";

export function ProfileSummary({ auditorId }: { auditorId: string }) {
  const profileQuery = useQuery({
    queryKey: ["auditor-profile", auditorId],
    queryFn: () => auditorApi.getProfile(auditorId),
  });

  if (profileQuery.isLoading) {
    return <p className="text-slate-400">Loading profile...</p>;
  }
  if (profileQuery.isError || !profileQuery.data) {
    return <p className="text-red-400">Failed to load auditor profile.</p>;
  }

  const profile = profileQuery.data;

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
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
                    {id}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
