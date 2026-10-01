"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Starts the MSW browser worker on mount and gates rendering of `children`
 * until it's ready, so nothing can fetch before mocking is registered.
 *
 * Lives in its own module (rather than inline in app/providers.tsx) and is
 * loaded via `next/dynamic(..., { ssr: false })` there, so `msw/browser`
 * (which only resolves under a "browser" module condition) never ends up in
 * the server/SSR compilation graph.
 */
export function MswProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("./browser")
      .then(({ worker }) => worker.start({ onUnhandledRequest: "bypass" }))
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err: unknown) => {
        console.error("[mocks] failed to start MSW worker:", err);
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
