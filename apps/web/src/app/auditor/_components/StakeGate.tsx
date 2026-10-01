"use client";

import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AuditorProfile } from "@bbm/shared";
import { auditorApi, ApiError } from "@/lib/api";

/** Minimum stake an auditor must have posted before the PoC-upload UI
 * unlocks. Deliberately set above the seed auditor's starting 5,000 stake
 * so the gate is demonstrable rather than already-satisfied out of the box. */
export const REQUIRED_STAKE = 10_000;

export function StakeGate({
  profile,
  auditorId,
  onStaked,
}: {
  profile: AuditorProfile;
  auditorId: string;
  onStaked: () => void;
}) {
  const shortfall = Math.max(REQUIRED_STAKE - profile.stake, 0);
  const [amount, setAmount] = useState(String(shortfall || 1_000));
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (value: number) => auditorApi.postStake({ auditorId, amount: value }),
    onSuccess: () => {
      setError(null);
      onStaked();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Failed to post stake.");
    },
  });

  const met = profile.stake >= REQUIRED_STAKE;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">Stake</p>
          <p className="text-lg font-semibold text-white">
            {profile.stake.toLocaleString()} / {REQUIRED_STAKE.toLocaleString()} required
          </p>
        </div>
        {met ? (
          <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-sm font-medium text-emerald-400">
            PoC upload unlocked
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/20 px-3 py-1 text-sm font-medium text-amber-400">
            PoC upload locked
          </span>
        )}
      </div>

      {!met && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = Number(amount);
            if (!Number.isFinite(value) || value <= 0) {
              setError("Enter a positive stake amount.");
              return;
            }
            mutation.mutate(value);
          }}
        >
          <label htmlFor="stake-amount" className="text-sm text-slate-400">
            Post stake
          </label>
          <input
            id="stake-amount"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-white"
          />
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded bg-emerald-500 px-3 py-1 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {mutation.isPending ? "Posting..." : "Post stake"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
