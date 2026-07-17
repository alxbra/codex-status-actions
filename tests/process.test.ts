import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runProcess } from "../src/platform/process";
import { sleep } from "../src/util";

describe("process runner", () => {
  it("terminates commands that exceed their deadline", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "process-timeout-"));
    const ready = path.join(directory, "ready");
    const marker = path.join(directory, "survived");
    try {
      await expect(
        runProcess(
          process.execPath,
          [
            "-e",
            'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], "ready"); setTimeout(() => fs.writeFileSync(process.argv[2], "alive"), 700)',
            ready,
            marker
          ],
          300
        )
      ).rejects.toMatchObject({ timedOut: true });
      await expect(access(ready)).resolves.toBeUndefined();
      await sleep(500);
      await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
