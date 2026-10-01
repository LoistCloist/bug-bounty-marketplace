"use client";

import { ROLES, useRoleStore, type Role } from "@/lib/role/store";

const LABELS: Record<Role, string> = {
  developer: "Developer",
  auditor: "Auditor",
  arbiter: "Arbiter",
};

export function RoleSwitcher() {
  const role = useRoleStore((s) => s.role);
  const setRole = useRoleStore((s) => s.setRole);

  return (
    <div className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 p-1">
      {ROLES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => setRole(r)}
          aria-pressed={role === r}
          className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
            role === r
              ? "bg-emerald-500 text-slate-950"
              : "text-slate-300 hover:bg-slate-800 hover:text-white"
          }`}
        >
          {LABELS[r]}
        </button>
      ))}
    </div>
  );
}
