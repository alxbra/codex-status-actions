import { MacOsTaskNavigator } from "./platform/macos/task-navigator";
import type { TaskNavigator } from "./types";

export function createTaskNavigator(platform: NodeJS.Platform = process.platform): TaskNavigator {
  if (platform === "darwin") return new MacOsTaskNavigator();
  throw new Error(`Task navigation is not supported on ${platform}`);
}
