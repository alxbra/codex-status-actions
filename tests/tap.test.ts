import { describe, expect, it } from "vitest";

import { isDoubleTap, type Tap } from "../src/tap";

const first: Tap = { at: 1_000, threadId: "thread-one" };

describe("tap classification", () => {
  it("keeps a first tap in background-selection mode", () => {
    expect(isDoubleTap(undefined, first, 500)).toBe(false);
  });

  it("focuses only a matching second tap inside the window", () => {
    expect(isDoubleTap(first, { at: 1_500, threadId: first.threadId }, 500)).toBe(true);
    expect(isDoubleTap(first, { at: 1_501, threadId: first.threadId }, 500)).toBe(false);
    expect(isDoubleTap(first, { at: 1_200, threadId: "thread-two" }, 500)).toBe(false);
  });

  it("rejects a second tap after a backwards clock adjustment", () => {
    expect(isDoubleTap(first, { at: 999, threadId: first.threadId }, 500)).toBe(false);
  });
});
