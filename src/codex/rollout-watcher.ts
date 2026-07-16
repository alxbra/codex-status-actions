import { open, stat } from "node:fs/promises";

import chokidar, { type FSWatcher } from "chokidar";

import type { StatusEvent } from "../status/reducer";
import { isThreadId } from "../util";

interface RolloutEvent {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    turn_id?: string;
  };
}

interface FileState {
  offset: number;
  remainder: string;
  processing?: Promise<void>;
}

export interface ParsedRolloutEvent {
  event: StatusEvent;
  baseline: boolean;
}

export class RolloutWatcher {
  private watcher: FSWatcher | undefined;
  private readonly files = new Map<string, FileState>();
  private readonly seen = new Set<string>();
  private initialScan = true;

  constructor(
    private readonly sessionsDirectory: string,
    private readonly storedOffsets: Record<string, number>,
    private readonly firstInstallation: boolean,
    private readonly onEvent: (event: ParsedRolloutEvent) => void,
    private readonly onOffsetsChanged: (offsets: Record<string, number>) => void
  ) {}

  async start(): Promise<void> {
    this.watcher = chokidar.watch(this.sessionsDirectory, {
      ignoreInitial: false,
      persistent: true,
      awaitWriteFinish: false,
      ignored: (filePath, metadata) => Boolean(metadata?.isFile() && !filePath.endsWith(".jsonl"))
    });
    this.watcher.on("add", (filePath) => this.queue(filePath));
    this.watcher.on("change", (filePath) => this.queue(filePath));
    await new Promise<void>((resolve, reject) => {
      this.watcher?.once("ready", () => {
        const pending = [...this.files.values()]
          .map((state) => state.processing)
          .filter((value): value is Promise<void> => Boolean(value));
        void Promise.all(pending).then(() => {
          this.initialScan = false;
          resolve();
        }, reject);
      });
      this.watcher?.once("error", reject);
    });
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = undefined;
  }

  private queue(filePath: string): void {
    const existing = this.files.get(filePath) ?? {
      offset: this.storedOffsets[filePath] ?? 0,
      remainder: ""
    };
    const isNew = !this.files.has(filePath);
    this.files.set(filePath, existing);
    const baseline = this.firstInstallation && this.initialScan && isNew && existing.offset === 0;
    existing.processing = (existing.processing ?? Promise.resolve())
      .then(() => this.readNewContent(filePath, existing, baseline))
      .catch(() => undefined);
  }

  private async readNewContent(filePath: string, state: FileState, baseline: boolean): Promise<void> {
    const metadata = await stat(filePath);
    if (metadata.size < state.offset) {
      state.offset = 0;
      state.remainder = "";
    }
    if (metadata.size === state.offset) return;

    const length = metadata.size - state.offset;
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, state.offset);
      state.offset = metadata.size;
      const text = state.remainder + buffer.toString("utf8");
      const lines = text.split("\n");
      state.remainder = lines.pop() ?? "";
      const threadId = threadIdFromPath(filePath);
      if (!threadId) return;

      for (const line of lines) this.parseLine(threadId, line, baseline);
      this.onOffsetsChanged(this.currentOffsets());
    } finally {
      await handle.close();
    }
  }

  private parseLine(threadId: string, line: string, baseline: boolean): void {
    if (!line.trim()) return;
    let record: RolloutEvent;
    try {
      record = JSON.parse(line) as RolloutEvent;
    } catch {
      return;
    }
    const timestamp = record.timestamp ? Date.parse(record.timestamp) : Date.now();
    if (!Number.isFinite(timestamp)) return;
    const payloadType = record.payload?.type;
    const turnId = record.payload?.turn_id;
    const fingerprint = `${threadId}:${record.timestamp ?? ""}:${record.type ?? ""}:${payloadType ?? ""}:${turnId ?? ""}`;
    if (this.seen.has(fingerprint)) return;
    this.seen.add(fingerprint);
    if (this.seen.size > 2_000) this.seen.delete(this.seen.values().next().value ?? "");

    let event: StatusEvent | undefined;
    if (record.type === "event_msg" && (payloadType === "task_started" || payloadType === "turn_started")) {
      event = { type: "turn-started", threadId, timestamp, ...(turnId ? { turnId } : {}) };
    } else if (
      record.type === "event_msg" &&
      (payloadType === "task_complete" || payloadType === "turn_complete")
    ) {
      event = { type: "turn-completed", threadId, timestamp, ...(turnId ? { turnId } : {}) };
    } else if (
      record.type === "event_msg" &&
      ["turn_aborted", "error", "stream_error"].includes(payloadType ?? "")
    ) {
      event = { type: "turn-error", threadId, timestamp, ...(turnId ? { turnId } : {}) };
    } else if (
      record.type === "response_item" ||
      (record.type === "event_msg" &&
        ["agent_message", "user_message", "patch_apply_end"].includes(payloadType ?? ""))
    ) {
      event = { type: "activity", threadId, timestamp };
    }
    if (event) this.onEvent({ event, baseline });
  }

  private currentOffsets(): Record<string, number> {
    return Object.fromEntries([...this.files].map(([filePath, state]) => [filePath, state.offset]));
  }
}

function threadIdFromPath(filePath: string): string | undefined {
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.jsonl$/i.exec(
    filePath
  );
  const candidate = match?.[1];
  return candidate && isThreadId(candidate) ? candidate : undefined;
}
