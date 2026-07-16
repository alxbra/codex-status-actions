export interface Tap {
  at: number;
  threadId: string;
}

export function isDoubleTap(previous: Tap | undefined, current: Tap, windowMs: number): boolean {
  if (!previous || previous.threadId !== current.threadId) return false;
  const elapsed = current.at - previous.at;
  return elapsed >= 0 && elapsed <= windowMs;
}
