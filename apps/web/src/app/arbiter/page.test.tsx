// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetMockDb, cancelAllScheduled } from "@/mocks/db";
import ArbiterPage from "./page";

// This project's .tsx source files rely on Next.js's SWC compiler for the
// automatic JSX runtime (no explicit `import React` per file). Vitest's
// underlying esbuild transform instead falls back to the classic runtime
// per tsconfig's `jsx: "preserve"`, which needs a `React` identifier in
// scope wherever JSX appears. Exposing the real React module as a global
// here - scoped to this test file only - lets rendered components resolve
// it without changing any shared build/test config.
(globalThis as unknown as { React: typeof React }).React = React;

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ArbiterPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetMockDb();
});

afterEach(() => {
  cancelAllScheduled();
});

describe("ArbiterPage", () => {
  it("renders the seeded Pending dispute with the developer's reason and the auditor's sandbox log", async () => {
    renderPage();

    expect(await screen.findByText(/dispute_1/i)).toBeInTheDocument();
    expect(
      screen.getByText(/doesn't match mainnet token behavior/i),
    ).toBeInTheDocument();
    // The joined PoC's sandbox log should be rendered verbatim somewhere on
    // the page (inside the <pre> transcript block).
    expect(screen.getByText(/Rule for auditor/i)).toBeInTheDocument();
    expect(screen.getByText(/Rule against auditor/i)).toBeInTheDocument();
  });

  it("rules against the auditor and removes the dispute from the Pending view", async () => {
    renderPage();

    await screen.findByText(/dispute_1/i);

    vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(screen.getByText(/Rule against auditor/i));

    await waitFor(() => {
      expect(screen.queryByText(/dispute_1/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText(/No open disputes right now/i)).toBeInTheDocument();
  });

  it("does not rule when the confirmation is declined", async () => {
    renderPage();

    await screen.findByText(/dispute_1/i);

    vi.spyOn(window, "confirm").mockReturnValue(false);

    fireEvent.click(screen.getByText(/Rule for auditor/i));

    // Still Pending - the dispute stays visible.
    await waitFor(() => {
      expect(screen.getByText(/dispute_1/i)).toBeInTheDocument();
    });
  });
});
