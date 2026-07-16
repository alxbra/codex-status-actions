import streamDeck from "@elgato/streamdeck";

import { StatusTileAction } from "./actions/status-tile-action";
import { StatusCoordinator } from "./status/coordinator";
import type { GlobalSettings } from "./types";

streamDeck.logger.setLevel("debug");

const action = new StatusTileAction();
streamDeck.actions.registerAction(action);

await streamDeck.connect();

const storedSettings = (await streamDeck.settings.getGlobalSettings()) as Partial<GlobalSettings>;
const coordinator = new StatusCoordinator(
  storedSettings,
  async (settings) => streamDeck.settings.setGlobalSettings(settings as never),
  (message) => streamDeck.logger.debug(message)
);
action.attach(coordinator);

await coordinator.start();

async function shutdown(): Promise<void> {
  await coordinator.stop();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
