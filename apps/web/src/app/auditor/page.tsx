"use client";

import { SEED_AUDITOR_ID } from "@/mocks/db";
import { ProfileSummary } from "./_components/ProfileSummary";
import { QueueList } from "./_components/QueueList";

export default function AuditorPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="eyebrow">AUDITOR WORKSPACE</p>
        <h1 className="text-2xl font-semibold text-white">Audit queue</h1>
        <p className="mt-2 text-slate-400">
          Find your next review. Claim a contract, prove the exploit, and earn the bounty.
        </p>
      </div>

      <ProfileSummary auditorId={SEED_AUDITOR_ID} />
      <QueueList auditorId={SEED_AUDITOR_ID} />
    </div>
  );
}
