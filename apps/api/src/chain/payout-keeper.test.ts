import { afterEach, describe, expect, it, vi } from "vitest";
import { startPayoutKeeper } from "./payout-keeper.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("startPayoutKeeper", () => {
  it("runs on each interval until stopped", async () => {
    vi.useFakeTimers();
    const runOnce = vi.fn(async () => undefined);
    const keeper = startPayoutKeeper({ runOnce, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(3500);
    expect(runOnce).toHaveBeenCalledTimes(3);

    await keeper.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runOnce).toHaveBeenCalledTimes(3);
  });

  it("does not start a pass while the previous one is still running", async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    const runOnce = vi.fn(
      () => new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const keeper = startPayoutKeeper({ runOnce, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(3500);
    expect(runOnce).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    finish();
    await keeper.stop();
  });

  it("reports a failed pass and keeps running", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const runOnce = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("rpc unavailable"))
      .mockResolvedValue(undefined);
    const keeper = startPayoutKeeper({ runOnce, intervalMs: 1000, onError });

    await vi.advanceTimersByTimeAsync(2500);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(runOnce).toHaveBeenCalledTimes(2);
    await keeper.stop();
  });
});
