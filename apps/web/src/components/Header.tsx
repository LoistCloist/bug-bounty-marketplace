"use client";

import Link from "next/link";
import { RoleSwitcher } from "./RoleSwitcher";
import { WalletBadge } from "./WalletBadge";

const NAV_LINKS = [
  { href: "/submit", label: "Submit" },
  { href: "/contracts", label: "Contracts" },
  { href: "/auditor", label: "Auditor" },
  { href: "/arbiter", label: "Arbiter" },
];

export function Header() {
  return (
    <header className="border-b border-slate-800 bg-slate-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-lg font-semibold text-white">
            Bug Bounty Marketplace
          </Link>
          <nav className="flex items-center gap-5">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-slate-300 hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <RoleSwitcher />
          <WalletBadge />
        </div>
      </div>
    </header>
  );
}
