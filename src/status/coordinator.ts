import path from "node:path";

import { AppServerClient } from "../codex/app-server-client";
import { RolloutWatcher, type ParsedRolloutEvent } from "../codex/rollout-watcher";
import { CATALOG_REFRESH_MS, DEFAULT_SETTINGS, PLUGIN_VERSION } from "../constants";
import { HookManager } from "../hooks/hook-manager";
import { HookServer } from "../hooks/hook-server";
import type {
  GlobalSettings,
  HealthSnapshot,
  HookEnvelope,
  PropertyInspectorSnapshot,
  ThreadRecord,
  ThreadRuntimeState,
  ThreadStatusSnapshot
} from "../types";
import { findCodexBinary, resolveCodexHome, toErrorMessage } from "../util";
import {
  initialRuntimeState,
  makeSnapshot,
  persistRuntimeState,
  reduceRuntimeState,
  type StatusEvent
} from "./reducer";

type PersistSettings = (settings: GlobalSettings) => Promise<void>;

export class StatusCoordinator {
  private settings: GlobalSettings;
  private health: HealthSnapshot = {
    codexBinary: "checking",
    catalog: "connecting",
    rolloutWatcher: "starting",
    hooks: "missing",
    navigation: "unchecked",
    restartRequired: false
  };
  private readonly threads = new Map<string, ThreadRecord>();
  private readonly runtime = new Map<string, ThreadRuntimeState>();
  private readonly listeners = new Set<() => void>();
  private appServer: AppServerClient | undefined;
  private rolloutWatcher: RolloutWatcher | undefined;
  private hookManager: HookManager | undefined;
  private hookServer: HookServer | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private persistTimer: NodeJS.Timeout | undefined;
  private hookCount = 0;
  private started = false;

  constructor(
    initialSettings: Partial<GlobalSettings>,
    private readonly persistSettings: PersistSettings,
    private readonly log: (message: string) => void
  ) {
    this.settings = normalizeSettings(initialSettings);
  }

  get codexHome(): string {
    return resolveCodexHome(this.settings);
  }

  get currentHealth(): Readonly<HealthSnapshot> {
    return this.health;
  }

  get unavailable(): boolean {
    return this.health.codexBinary === "missing" || this.health.catalog === "disconnected";
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.startServices();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.refreshTimer = undefined;
    this.persistTimer = undefined;
    await Promise.allSettled([this.rolloutWatcher?.stop(), this.hookServer?.stop(), this.appServer?.stop()]);
    this.rolloutWatcher = undefined;
    this.hookServer = undefined;
    this.hookManager = undefined;
    this.appServer = undefined;
    await this.persistNow();
  }

  snapshot(): ReadonlyMap<string, ThreadStatusSnapshot> {
    const snapshots = new Map<string, ThreadStatusSnapshot>();
    for (const [threadId, thread] of this.threads) {
      const runtime =
        this.runtime.get(threadId) ?? initialRuntimeState(this.settings.threadStates?.[threadId]);
      snapshots.set(threadId, makeSnapshot(thread, runtime));
    }
    return snapshots;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  acknowledge(threadId: string): void {
    this.applyEvent({ type: "acknowledged", threadId, timestamp: Date.now() });
  }

  markNavigation(available: boolean, message?: string): void {
    this.updateHealth({ navigation: available ? "available" : "error", ...(message ? { message } : {}) });
  }

  propertySnapshot(): PropertyInspectorSnapshot {
    return {
      type: "snapshot",
      settings: this.settings,
      health: this.health,
      hookCount: this.hookCount,
      codexHome: this.codexHome,
      version: PLUGIN_VERSION
    };
  }

  diagnostics(): string {
    return JSON.stringify(
      {
        pluginVersion: PLUGIN_VERSION,
        platform: process.platform,
        architecture: process.arch,
        codexHome: this.codexHome,
        health: this.health,
        taskCount: this.threads.size,
        hookCount: this.hookCount,
        enhancedStatusEnabled: this.settings.enhancedStatusEnabled
      },
      null,
      2
    );
  }

  async trustHooks(): Promise<void> {
    if (!this.hookManager) throw new Error("Hook manager is not available");
    await this.hookManager.trust(process.cwd());
    this.updateHealth({ restartRequired: true });
    await this.refreshHookStatus();
  }

  async reinstallHooks(): Promise<void> {
    if (!this.hookManager) throw new Error("Hook manager is not available");
    const changed = await this.hookManager.install();
    if (changed) this.updateHealth({ restartRequired: true });
    await this.refreshHookStatus(true);
  }

  async setEnhancedStatus(enabled: boolean): Promise<void> {
    if (this.settings.enhancedStatusEnabled === enabled) return;
    this.settings = { ...this.settings, enhancedStatusEnabled: enabled };
    if (enabled) {
      await this.hookServer?.start();
      await this.reinstallHooks();
    } else {
      await this.hookServer?.stop();
      const cleanup = await this.hookManager?.uninstall(process.cwd());
      this.hookCount = 0;
      this.updateHealth({
        hooks: "disabled",
        restartRequired: true,
        ...(cleanup?.manualCleanupRequired
          ? { message: "A modified status hook was disabled but left in hooks.json for manual review" }
          : {})
      });
    }
    await this.persistNow();
    this.emitChange();
  }

  async setCodexHome(codexHome?: string): Promise<void> {
    const normalized = codexHome?.trim();
    if (normalized) this.settings = { ...this.settings, codexHome: normalized };
    else {
      const settings = { ...this.settings };
      delete settings.codexHome;
      this.settings = settings;
    }
    await this.persistNow();
    if (this.started) {
      await this.stop();
      this.started = true;
      await this.startServices();
    }
  }

  private async startServices(): Promise<void> {
    const binary = await findCodexBinary();
    if (!binary) {
      this.updateHealth({
        codexBinary: "missing",
        catalog: "disconnected",
        message: "Codex binary not found"
      });
    } else {
      this.updateHealth({ codexBinary: "available", catalog: "connecting", navigation: "available" });
    }

    this.appServer = new AppServerClient(binary);
    this.appServer.on("connected", () => this.updateHealth({ catalog: "connected" }));
    this.appServer.on("disconnected", (error: Error) => {
      this.updateHealth({ catalog: "disconnected", message: error.message });
    });
    this.appServer.on("diagnostic", (message: string) => this.log(`app-server: ${message}`));
    this.hookManager = new HookManager(this.codexHome, this.appServer);
    this.hookServer = new HookServer(this.codexHome, (envelope) => this.handleHook(envelope));

    try {
      await this.appServer.start();
      await this.refreshCatalog();
    } catch (error) {
      this.updateHealth({ catalog: "disconnected", message: toErrorMessage(error) });
    }

    this.rolloutWatcher = new RolloutWatcher(
      path.join(this.codexHome, "sessions"),
      this.settings.rolloutOffsets ?? {},
      !this.settings.initialized,
      (event) => this.handleRolloutEvent(event),
      (offsets) => {
        this.settings = { ...this.settings, rolloutOffsets: offsets };
        this.schedulePersist();
      }
    );
    try {
      await this.rolloutWatcher.start();
      this.updateHealth({ rolloutWatcher: "watching" });
    } catch (error) {
      this.updateHealth({ rolloutWatcher: "error", message: toErrorMessage(error) });
    }

    if (this.settings.enhancedStatusEnabled) {
      try {
        await this.hookServer.start();
        const changed = await this.hookManager.install();
        if (changed) this.updateHealth({ restartRequired: true });
        await this.refreshHookStatus(true);
      } catch (error) {
        this.updateHealth({ hooks: "error", message: toErrorMessage(error) });
      }
    } else {
      this.updateHealth({ hooks: "disabled" });
    }

    this.settings = { ...this.settings, initialized: true };
    await this.persistNow();
    this.refreshTimer = setInterval(() => void this.refreshCatalog(), CATALOG_REFRESH_MS);
  }

  private async refreshCatalog(): Promise<void> {
    if (!this.appServer) return;
    try {
      const records = await this.appServer.listThreads(200);
      const nextIds = new Set<string>();
      for (const record of records) {
        nextIds.add(record.id);
        const previous = this.threads.get(record.id);
        const runtime =
          this.runtime.get(record.id) ?? initialRuntimeState(this.settings.threadStates?.[record.id]);
        this.runtime.set(record.id, runtime);
        this.threads.set(record.id, {
          ...record,
          updatedAt: Math.max(record.updatedAt, previous?.updatedAt ?? 0, runtime.changedAt)
        });
      }
      for (const id of this.threads.keys()) {
        if (!nextIds.has(id)) this.threads.delete(id);
      }
      this.updateHealth({ catalog: "connected" });
      this.emitChange();
    } catch (error) {
      this.updateHealth({ catalog: "disconnected", message: toErrorMessage(error) });
    }
  }

  private handleRolloutEvent({ event, baseline }: ParsedRolloutEvent): void {
    this.applyEvent(event);
    if (baseline && event.type === "turn-completed") {
      this.applyEvent({ type: "acknowledged", threadId: event.threadId, timestamp: event.timestamp });
    }
  }

  private handleHook(envelope: HookEnvelope): void {
    if (!this.settings.enhancedStatusEnabled) return;
    this.applyEvent({ type: "hook", envelope });
  }

  private applyEvent(event: StatusEvent): void {
    const threadId = event.type === "hook" ? event.envelope.threadId : event.threadId;
    const previous =
      this.runtime.get(threadId) ?? initialRuntimeState(this.settings.threadStates?.[threadId]);
    const next = reduceRuntimeState(previous, event);
    this.runtime.set(threadId, next);
    const thread = this.threads.get(threadId);
    if (thread && next.changedAt >= previous.changedAt) {
      this.threads.set(threadId, { ...thread, updatedAt: Math.max(thread.updatedAt, next.changedAt) });
    }
    this.schedulePersist();
    this.emitChange();
  }

  private async refreshHookStatus(retryAfterRestart = false): Promise<void> {
    if (!this.hookManager) return;
    let result = await this.hookManager.status(process.cwd());
    if (retryAfterRestart && result.status === "missing" && this.appServer) {
      await this.appServer.stop();
      await this.appServer.start();
      result = await this.hookManager.status(process.cwd());
    }
    this.hookCount = result.count;
    this.updateHealth({ hooks: result.status });
  }

  private updateHealth(patch: Partial<HealthSnapshot>): void {
    this.health = { ...this.health, ...patch };
    this.emitChange();
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persistNow(), 400);
  }

  private async persistNow(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    const threadStates = Object.fromEntries(
      [...this.runtime].map(([threadId, runtime]) => [threadId, persistRuntimeState(runtime)])
    );
    this.settings = { ...this.settings, threadStates };
    await this.persistSettings(this.settings);
  }
}

function normalizeSettings(settings: Partial<GlobalSettings>): GlobalSettings {
  return {
    assignmentMode: "recent",
    enhancedStatusEnabled: settings.enhancedStatusEnabled ?? DEFAULT_SETTINGS.enhancedStatusEnabled,
    initialized: settings.initialized ?? false,
    threadStates: settings.threadStates ?? {},
    rolloutOffsets: settings.rolloutOffsets ?? {},
    ...(settings.codexHome?.trim() ? { codexHome: settings.codexHome.trim() } : {})
  };
}
