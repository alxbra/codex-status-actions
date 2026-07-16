import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { RolloutWatcher, type ParsedRolloutEvent } from "../src/codex/rollout-watcher";

const threadId = "019f6b6d-644d-7701-8858-9da6837aaaaa";

describe("rollout watcher", () => {
  it("baselines old completions and emits appended turns as live", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-rollout-"));
    const sessions = path.join(root, "sessions", "2026", "07", "16");
    await mkdir(sessions, { recursive: true });
    const file = path.join(sessions, `rollout-${threadId}.jsonl`);
    await writeFile(
      file,
      `${JSON.stringify({ type: "event_msg", timestamp: "2026-07-16T10:00:00Z", payload: { type: "task_complete", turn_id: "old" } })}\n`
    );

    const events: ParsedRolloutEvent[] = [];
    const watcher = new RolloutWatcher(
      sessions,
      {},
      true,
      (event) => events.push(event),
      () => undefined
    );
    await watcher.start();
    expect(events.some(({ event, baseline }) => event.type === "turn-completed" && baseline)).toBe(true);

    await appendFile(
      file,
      `${JSON.stringify({ type: "event_msg", timestamp: "2026-07-16T10:01:00Z", payload: { type: "task_started", turn_id: "new" } })}\n`
    );
    await waitFor(() => events.some(({ event, baseline }) => event.type === "turn-started" && !baseline));
    await watcher.stop();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const timeout = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > timeout) throw new Error("Timed out waiting for rollout event");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
