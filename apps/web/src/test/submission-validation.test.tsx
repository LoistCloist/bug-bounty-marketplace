// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SubmitPage from "@/app/submit/page";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <SubmitPage />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText(/contract source/i), {
    target: { files: [new File(["contract Demo {}"], "Demo.sol")] },
  });
  fireEvent.change(screen.getByLabelText(/deadline/i), { target: { value: "2030-01-01T00:00" } });
}
describe("submission validation", () => {
  beforeEach(setup);
  it("rejects an empty source file", async () => {
    fireEvent.change(screen.getByLabelText(/contract source/i), {
      target: { files: [new File([], "Empty.sol")] },
    });
    expect(await screen.findByText("The source file is empty.")).toBeInTheDocument();
  });
  it("rejects a past deadline", async () => {
    fireEvent.change(screen.getByLabelText(/deadline/i), { target: { value: "2020-01-01T00:00" } });
    fireEvent.submit(screen.getByRole("button", { name: "Submit contract" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a deadline in the future.");
  });
  it("rejects a zero bounty even when native validation is bypassed", async () => {
    fireEvent.change(screen.getByLabelText(/bounty amount/i), { target: { value: "0" } });
    fireEvent.submit(screen.getByRole("button", { name: "Submit contract" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a bounty amount greater than zero.",
    );
  });
});
