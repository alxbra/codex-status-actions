import { afterAll, describe, expect, it } from "vitest";

import { AppServerClient } from "../src/codex/app-server-client";
import { CODEX_APP_PATH } from "../src/constants";
import { HookManager } from "../src/hooks/hook-manager";
import { resolveCodexHome } from "../src/util";

const runLive = process.env.RUN_CODEX_LIVE === "1";
const client = new AppServerClient(CODEX_APP_PATH);

describe.skipIf(!runLive)("installed Codex integration", () => {
  afterAll(async () => client.stop());

  it("lists local tasks through the installed app-server", async () => {
    const threads = await client.listThreads(20);
    expect(threads.length).toBeGreaterThan(0);
    expect(threads.every((thread) => thread.id.length === 36)).toBe(true);
  });

  it("installs and discovers exactly three owned status hooks", async () => {
    const manager = new HookManager(resolveCodexHome({}), client);
    await manager.install();
    await client.stop();
    await client.start();
    const hooks = await manager.listOwned(process.cwd());
    expect(hooks).toHaveLength(3);
    expect(hooks.every((hook) => ["untrusted", "trusted"].includes(hook.trustStatus))).toBe(true);
  });
});
