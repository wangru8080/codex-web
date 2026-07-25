import type { FileUpdateChange } from "@/codex/protocol/generated/v2/FileUpdateChange";

import type { AppServerTurnState } from "./turn-reducer";

export type TurnFileChange = FileUpdateChange & {
  additions: number;
  deletions: number;
};

export type TurnFileChangeSummary = {
  fileCount: number;
  additions: number;
  deletions: number;
  files: TurnFileChange[];
  sourceBreadcrumb: "app-server.item/fileChange/patchUpdated";
};

export function deriveTurnFileChangeSummary(
  turn: AppServerTurnState | null,
): TurnFileChangeSummary | null {
  if (!turn) return null;

  const changesByPath = new Map<string, FileUpdateChange>();
  const handledItemIds = new Set<string>();

  for (const item of turn.items) {
    if (item.type !== "fileChange") continue;
    handledItemIds.add(item.id);
    if (item.status === "failed" || item.status === "declined") continue;
    for (const change of turn.filePatchChanges[item.id] ?? item.changes) {
      changesByPath.set(change.path, change);
    }
  }

  for (const [itemId, changes] of Object.entries(turn.filePatchChanges)) {
    if (handledItemIds.has(itemId)) continue;
    for (const change of changes) changesByPath.set(change.path, change);
  }

  const files = [...changesByPath.values()]
    .map((change) => ({ ...change, ...countDiffLines(change.diff) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (files.length === 0) return null;

  return {
    fileCount: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    files,
    sourceBreadcrumb: "app-server.item/fileChange/patchUpdated",
  };
}

function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }

  return { additions, deletions };
}
