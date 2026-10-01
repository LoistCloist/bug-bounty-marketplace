"use client";

import { useEffect, useState } from "react";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Live-updating "time remaining" readout for a claim's expiry. Re-renders
 * every second off a local tick rather than the expiry value itself, so it
 * counts down smoothly between refetches. */
export function ClaimCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  const remainingMs = new Date(expiresAt).getTime() - now;

  return (
    <span className={remainingMs <= 0 ? "font-mono text-red-400" : "font-mono text-emerald-400"}>
      {formatRemaining(remainingMs)}
    </span>
  );
}
