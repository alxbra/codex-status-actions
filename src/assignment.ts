import type { ThreadStatusSnapshot } from "./types";

export interface TilePosition {
  contextId: string;
  deviceId: string;
  row: number;
  column: number;
}

export function sortRecentThreads(threads: Iterable<ThreadStatusSnapshot>): ThreadStatusSnapshot[] {
  return [...threads]
    .filter(({ thread }) => !thread.archived && !thread.ephemeral && !thread.parentThreadId)
    .sort((left, right) => {
      const recency = right.thread.updatedAt - left.thread.updatedAt;
      return recency || left.thread.id.localeCompare(right.thread.id);
    });
}

export function assignMostRecent(
  tiles: Iterable<TilePosition>,
  threads: Iterable<ThreadStatusSnapshot>
): Map<string, ThreadStatusSnapshot | undefined> {
  const recent = sortRecentThreads(threads);
  const byDevice = new Map<string, TilePosition[]>();

  for (const tile of tiles) {
    const deviceTiles = byDevice.get(tile.deviceId) ?? [];
    deviceTiles.push(tile);
    byDevice.set(tile.deviceId, deviceTiles);
  }

  const result = new Map<string, ThreadStatusSnapshot | undefined>();
  for (const deviceTiles of byDevice.values()) {
    deviceTiles.sort(
      (a, b) => a.row - b.row || a.column - b.column || a.contextId.localeCompare(b.contextId)
    );
    deviceTiles.forEach((tile, index) => result.set(tile.contextId, recent[index]));
  }
  return result;
}
