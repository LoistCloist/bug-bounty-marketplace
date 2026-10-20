import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cancelAllScheduled, resetMockDb } from "@/mocks/db";
import { developerApi } from "@/lib/api";

beforeEach(() => {
  resetMockDb();
});

afterEach(() => {
  cancelAllScheduled();
});

describe("mock GET /api/contracts/:id/analysis", () => {
  it("reports Running before the mocked analysis has produced findings", async () => {
    const contract = await developerApi.submitContract({
      file: new File(["pragma solidity ^0.8.19;\ncontract A {}\n"], "A.sol"),
      developerAddress: `0x${"d1".repeat(20)}`,
      bountyAmount: 1,
      deadline: "2030-01-01T00:00:00.000Z",
    });
    const running = await developerApi.getAnalysisStatus(contract.id);
    expect(running).toMatchObject({ contractId: contract.id, status: "Running", findingCount: 0 });
  });

  it("returns 404 for an unknown contract", async () => {
    await expect(developerApi.getAnalysisStatus("contract_missing")).rejects.toMatchObject({
      status: 404,
    });
  });
});
