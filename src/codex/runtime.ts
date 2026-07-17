import { EventEmitter } from "node:events";

import { AppServerClient, type HookMetadata, type RateLimitsSnapshot } from "./app-server-client";

export class CodexRuntime extends EventEmitter {
  private client: AppServerClient | undefined;
  private starting: Promise<void> | undefined;

  constructor(
    private readonly resolveCodexHome: () => string,
    private readonly binaryOverride?: string
  ) {
    super();
  }

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  async start(): Promise<void> {
    if (this.connected) return;
    if (this.starting) return this.starting;
    const client = this.client ?? this.createClient();
    this.client = client;
    this.starting = client.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.starting = undefined;
    await client?.stop();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async listThreads(limit?: number) {
    await this.start();
    return this.requiredClient.listThreads(limit);
  }

  async listHooks(cwd: string, ownedCommand: string): Promise<HookMetadata[]> {
    await this.start();
    return this.requiredClient.listHooks(cwd, ownedCommand);
  }

  async writeHookStates(
    states: Record<string, { enabled: boolean; trusted_hash?: string | null }>
  ): Promise<void> {
    await this.start();
    await this.requiredClient.writeHookStates(states);
  }

  async readRateLimits(): Promise<RateLimitsSnapshot> {
    await this.start();
    return this.requiredClient.readRateLimits();
  }

  private createClient(): AppServerClient {
    const client = new AppServerClient(this.binaryOverride, this.resolveCodexHome());
    client.on("connected", () => this.emit("connected"));
    client.on("disconnected", (error: Error) => this.emit("disconnected", error));
    client.on("diagnostic", (message: string) => this.emit("diagnostic", message));
    client.on("rateLimitsUpdated", () => this.emit("rateLimitsUpdated"));
    return client;
  }

  private get requiredClient(): AppServerClient {
    if (!this.client) throw new Error("Codex app-server is not available");
    return this.client;
  }
}
