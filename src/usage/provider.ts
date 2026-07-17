import type { EventEmitter } from "node:events";

import type { RateLimitsSnapshot } from "../codex/app-server-client";
import type { JsonObject } from "@elgato/utils";
import { USAGE_CLOCK_TICK_MS } from "../constants";
import { normalizeRateLimits, type RefreshSeconds, type UsageSnapshot } from "./model";

interface Registration {
  refreshSeconds: RefreshSeconds;
  clockSensitive: boolean;
}

type UsageRuntime = Pick<EventEmitter, "on" | "off"> & {
  readRateLimits(): Promise<RateLimitsSnapshot>;
};

export interface UsageHealthSnapshot extends JsonObject {
  status: UsageSnapshot["status"];
  fetching: boolean;
  lastSuccessfulRefresh?: number;
  availableWindows: string[];
  message?: string;
}

export class UsageProvider {
  private state: UsageSnapshot = { status: "loading", windows: {} };
  private readonly registrations = new Map<string, Registration>();
  private readonly listeners = new Set<() => void>();
  private pollTimer: NodeJS.Timeout | undefined;
  private clockTimer: NodeJS.Timeout | undefined;
  private notificationTimer: NodeJS.Timeout | undefined;
  private inFlight: Promise<boolean> | undefined;
  private started = false;

  constructor(
    private readonly runtime: UsageRuntime,
    private readonly log: (message: string) => void
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.runtime.on("rateLimitsUpdated", this.handleRateLimitsUpdated);
    this.runtime.on("disconnected", this.handleDisconnected);
    this.runtime.on("connected", this.handleConnected);
    this.schedule();
    if (this.registrations.size > 0) void this.refresh();
  }

  stop(): void {
    this.started = false;
    this.runtime.off("rateLimitsUpdated", this.handleRateLimitsUpdated);
    this.runtime.off("disconnected", this.handleDisconnected);
    this.runtime.off("connected", this.handleConnected);
    this.clearTimers();
    this.listeners.clear();
  }

  snapshot(): UsageSnapshot {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  register(contextId: string, registration: Registration): void {
    const wasEmpty = this.registrations.size === 0;
    this.registrations.set(contextId, registration);
    this.schedule();
    if (this.started && wasEmpty) void this.refresh();
  }

  unregister(contextId: string): void {
    this.registrations.delete(contextId);
    this.schedule();
  }

  async refresh(): Promise<boolean> {
    if (this.inFlight) return this.inFlight;
    if (!this.state.lastSuccessfulRefresh) {
      this.state = { status: "loading", windows: {} };
      this.emitChange();
    }
    this.inFlight = this.performRefresh().finally(() => {
      this.inFlight = undefined;
      this.emitChange();
    });
    this.emitChange();
    return this.inFlight;
  }

  healthSnapshot(): UsageHealthSnapshot {
    return {
      status: this.state.status,
      fetching: Boolean(this.inFlight),
      ...(this.state.lastSuccessfulRefresh
        ? { lastSuccessfulRefresh: this.state.lastSuccessfulRefresh }
        : {}),
      availableWindows: Object.keys(this.state.windows),
      ...(this.state.error ? { message: this.state.error } : {})
    };
  }

  diagnostics(): string {
    return JSON.stringify(
      {
        status: this.state.status,
        fetching: Boolean(this.inFlight),
        hasSuccessfulRefresh: Boolean(this.state.lastSuccessfulRefresh),
        availableWindows: Object.keys(this.state.windows),
        visibleTileCount: this.registrations.size
      },
      null,
      2
    );
  }

  private async performRefresh(): Promise<boolean> {
    try {
      const windows = normalizeRateLimits(await this.runtime.readRateLimits());
      this.state = { status: "ready", windows, lastSuccessfulRefresh: Date.now() };
      return true;
    } catch {
      const message = "Usage data could not be fetched";
      this.log(message);
      this.state = this.state.lastSuccessfulRefresh
        ? { ...this.state, status: "stale", error: message }
        : { status: "error", windows: {}, error: message };
      return false;
    }
  }

  private readonly handleRateLimitsUpdated = (): void => {
    if (this.registrations.size === 0) return;
    if (this.notificationTimer) clearTimeout(this.notificationTimer);
    this.notificationTimer = setTimeout(() => {
      this.notificationTimer = undefined;
      if (this.registrations.size > 0) void this.refresh();
    }, 250);
  };

  private readonly handleDisconnected = (): void => {
    if (this.state.lastSuccessfulRefresh) {
      this.state = { ...this.state, status: "stale", error: "Codex app-server disconnected" };
    } else this.state = { status: "error", windows: {}, error: "Codex app-server disconnected" };
    this.emitChange();
  };

  private readonly handleConnected = (): void => {
    if (this.registrations.size > 0) void this.refresh();
  };

  private schedule(): void {
    if (!this.started) return;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.pollTimer = undefined;
    this.clockTimer = undefined;
    if (this.registrations.size === 0) return;

    const interval = Math.min(
      ...[...this.registrations.values()].map(({ refreshSeconds }) => refreshSeconds)
    );
    this.pollTimer = setInterval(() => void this.refresh(), interval * 1_000);
    if ([...this.registrations.values()].some(({ clockSensitive }) => clockSensitive)) {
      this.clockTimer = setInterval(() => {
        const expired = Object.values(this.state.windows).some((window) => window.resetsAt <= Date.now());
        const refreshIsOld =
          !this.state.lastSuccessfulRefresh || Date.now() - this.state.lastSuccessfulRefresh > 5_000;
        if (expired && refreshIsOld && this.state.status === "ready") void this.refresh();
        else this.emitChange();
      }, USAGE_CLOCK_TICK_MS);
    }
  }

  private clearTimers(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    if (this.notificationTimer) clearTimeout(this.notificationTimer);
    this.pollTimer = undefined;
    this.clockTimer = undefined;
    this.notificationTimer = undefined;
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }
}
