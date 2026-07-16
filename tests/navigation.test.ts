import { describe, expect, it } from "vitest";

import { createTaskNavigator } from "../src/navigation";
import { MacOsTaskNavigator } from "../src/platform/macos/task-navigator";
import { taskDeepLink } from "../src/task-link";

const threadId = "019f6b6d-644d-7701-8858-9da6837aaaaa";
const codexBundleId = "com.openai.codex";

describe("task navigation", () => {
  it("builds a task URL only for UUIDs", () => {
    expect(taskDeepLink(threadId)).toBe(`codex://threads/${threadId}`);
    expect(() => taskDeepLink("../../bad")).toThrow("Invalid Codex task identifier");
  });

  it("selects the platform adapter explicitly", () => {
    expect(createTaskNavigator("darwin")).toBeInstanceOf(MacOsTaskNavigator);
    expect(() => createTaskNavigator("win32")).toThrow("Task navigation is not supported on win32");
  });

  it("keeps macOS command details inside the adapter", async () => {
    const commands: Array<{ executable: string; args: readonly string[] }> = [];
    const waits: number[] = [];
    const navigator = new MacOsTaskNavigator(
      (executable, args) => {
        commands.push({ executable, args: [...args] });
        return Promise.resolve();
      },
      (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      }
    );

    await navigator.selectTask(threadId, "background");
    expect(commands).toEqual([{ executable: "/usr/bin/open", args: ["-g", `codex://threads/${threadId}`] }]);
    expect(waits).toEqual([]);

    commands.length = 0;
    await navigator.selectTask(threadId, "foreground");
    expect(commands).toEqual([
      { executable: "/usr/bin/open", args: ["-b", codexBundleId] },
      { executable: "/usr/bin/open", args: ["-g", `codex://threads/${threadId}`] }
    ]);
    expect(waits).toEqual([175]);
  });
});
