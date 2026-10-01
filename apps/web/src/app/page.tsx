import Link from "next/link";

const CARDS = [
  {
    href: "/submit",
    title: "Submit a contract",
    body: "Developers: upload a .sol file, fund a bounty, and get AI-flagged findings.",
  },
  {
    href: "/auditor",
    title: "Audit queue",
    body: "Auditors: claim an open contract, submit a PoC, and get paid when it's verified.",
  },
  {
    href: "/arbiter",
    title: "Resolve disputes",
    body: "Arbiters: review a disputed finding's PoC and sandbox log, then rule on it.",
  },
];

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl font-semibold text-white">Bug Bounty Marketplace</h1>
        <p className="mt-2 max-w-2xl text-slate-400">
          AI-assisted smart contract security auditing. Slither findings are explained by an LLM,
          verified by human auditors with a sandboxed proof-of-concept, and paid out automatically
          once the challenge window passes undisputed.
        </p>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 transition-colors hover:border-emerald-500"
          >
            <h2 className="font-medium text-white">{card.title}</h2>
            <p className="mt-2 text-sm text-slate-400">{card.body}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
