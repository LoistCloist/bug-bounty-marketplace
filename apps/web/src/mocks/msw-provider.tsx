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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("./browser")
      .then(({ worker }) => worker.start({ onUnhandledRequest: "bypass" }))
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err: unknown) => {
        console.error("[mocks] failed to start MSW worker:", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed)
    return (
      <div className="empty-state" role="alert">
        <h1>Could not start the demo</h1>
        <p>
          The mock API needs a working service worker. Use localhost or HTTPS and reload to retry.
        </p>
        <button className="button-primary" onClick={() => window.location.reload()}>
          Reload demo
        </button>
      </div>
    );
  if (!ready)
    return (
      <div className="empty-state" role="status">
        Preparing your security workspace…
      </div>
    );
  return <>{children}</>;
}
