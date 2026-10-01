// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SubmitPage from "../page";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SubmitPage />
    </QueryClientProvider>,
  );
}

describe("SubmitPage", () => {
  it("shows an inline error and blocks submission for a non-.sol file", async () => {
    renderWithProviders();

    const fileInput = screen.getByLabelText(/contract source/i) as HTMLInputElement;
    const badFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [badFile] } });

    expect(await screen.findByText(/only \.sol files are accepted/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/deadline/i), {
      target: { value: "2030-01-01T00:00" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /submit contract/i }).closest("form")!);

    await waitFor(() => {
      expect(pushMock).not.toHaveBeenCalled();
    });
  });

  it("shows an inline error for a file over the 100 KB limit", async () => {
    renderWithProviders();

    const fileInput = screen.getByLabelText(/contract source/i) as HTMLInputElement;
    const oversized = new File([new Uint8Array(102_401)], "Big.sol", {
      type: "text/plain",
    });
    fireEvent.change(fileInput, { target: { files: [oversized] } });

    expect(await screen.findByText(/file is too large/i)).toBeInTheDocument();
  });

  it("accepts a valid .sol file under the size limit with no inline error", () => {
    renderWithProviders();

    const fileInput = screen.getByLabelText(/contract source/i) as HTMLInputElement;
    const goodFile = new File(["contract Foo {}"], "Foo.sol", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [goodFile] } });

    expect(screen.queryByText(/only \.sol files are accepted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/file is too large/i)).not.toBeInTheDocument();
  });
});
