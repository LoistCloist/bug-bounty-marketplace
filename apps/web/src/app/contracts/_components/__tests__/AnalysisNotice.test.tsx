// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalysisNotice } from "../AnalysisNotice";

const base = {
  contractId: "contract_1",
  error: null,
  findingCount: 0,
  updatedAt: "2026-10-20T12:00:00.000Z",
};

describe("AnalysisNotice", () => {
  it("says analysis is running while queued or running", () => {
    render(<AnalysisNotice status={{ ...base, status: "Queued" }} />);
    expect(screen.getByText(/Analysis is still running/)).toBeTruthy();
  });

  it("shows the compiler error when analysis failed", () => {
    render(
      <AnalysisNotice
        status={{ ...base, status: "Failed", error: "Error: Expected type name\n --> A.sol:3:15:" }}
      />,
    );
    expect(screen.getByText(/Analysis failed/)).toBeTruthy();
    expect(screen.getByText(/Expected type name/)).toBeTruthy();
  });

  it("says no issues were found when analysis finished with zero findings", () => {
    render(<AnalysisNotice status={{ ...base, status: "Done" }} />);
    expect(screen.getByText(/Slither found no issues/)).toBeTruthy();
  });

  it("falls back to the running message before the status has loaded", () => {
    render(<AnalysisNotice status={undefined} />);
    expect(screen.getByText(/Analysis is still running/)).toBeTruthy();
  });
});
