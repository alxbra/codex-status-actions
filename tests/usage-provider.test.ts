import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RateLimitsSnapshot } from "../src/codex/app-server-client";
import { UsageProvider } from "../src/usage/provider";

afterEach(() => {
  vi.useRealTimers();
});

describe("usage provider", () => {
  it("refreshes immediately, coalesces requests, and preserves stale data", async () => {
    const runtime = new FakeRuntime();
    const provider = new UsageProvider(runtime, () => undefined);
    provider.register("one", { refreshSeconds: 300, clockSensitive: false });
    provider.start();
    await vi.waitFor(() => expect(provider.snapshot().status).toBe("ready"));
    expect(runtime.reads).toBe(1);

    runtime.failure = new Error("offline /private/path");
    const [first, second] = await Promise.all([provider.refresh(), provider.refresh()]);
    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(runtime.reads).toBe(2);
    expect(provider.snapshot()).toMatchObject({ status: "stale" });
    expect(provider.diagnostics()).not.toContain("usedPercent");
    provider.stop();
  });

  it("uses the shortest visible interval and reacts to notifications", async () => {
    vi.useFakeTimers();
    const runtime = new FakeRuntime();
    const provider = new UsageProvider(runtime, () => undefined);
    provider.register("slow", { refreshSeconds: 900, clockSensitive: false });
    provider.register("fast", { refreshSeconds: 60, clockSensitive: true });
    provider.start();
    vi.runAllTicks();
    await Promise.resolve();
    expect(runtime.reads).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runtime.reads).toBe(2);
    runtime.emit("rateLimitsUpdated");
    await vi.advanceTimersByTimeAsync(250);
    expect(runtime.reads).toBe(3);

    provider.unregister("fast");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runtime.reads).toBe(3);
    provider.stop();
  });

  it("stops polling when no tiles remain", async () => {
    vi.useFakeTimers();
    const runtime = new FakeRuntime();
    const provider = new UsageProvider(runtime, () => undefined);
    provider.register("one", { refreshSeconds: 60, clockSensitive: false });
    provider.start();
    vi.runAllTicks();
    await Promise.resolve();
    expect(runtime.reads).toBe(1);
    runtime.emit("rateLimitsUpdated");
    provider.unregister("one");
    await vi.advanceTimersByTimeAsync(250);
    expect(runtime.reads).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runtime.reads).toBe(1);
    provider.stop();
  });
});

class FakeRuntime extends EventEmitter {
  reads = 0;
  failure: Error | undefined;
  snapshot: RateLimitsSnapshot = [{ usedPercent: 25, windowDurationMins: 300, resetsAt: 2_000 }];

  readRateLimits(): Promise<RateLimitsSnapshot> {
    this.reads++;
    return this.failure ? Promise.reject(this.failure) : Promise.resolve(this.snapshot);
  }
}
