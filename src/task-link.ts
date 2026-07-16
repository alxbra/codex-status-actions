import { isThreadId } from "./util";

export function taskDeepLink(threadId: string): string {
  if (!isThreadId(threadId)) throw new Error("Invalid Codex task identifier");
  return `codex://threads/${threadId}`;
}
