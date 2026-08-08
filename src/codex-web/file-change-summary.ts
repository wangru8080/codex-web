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
  lifecycleSourceBreadcrumb?: "app-server.command/exec:git-status";
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
    .map((change) => ({ ...change, ...countChangeLines(change) }))
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

function countChangeLines(change: FileUpdateChange): { additions: number; deletions: number } {
  if (change.kind.type === "add") return { additions: countContentLines(change.diff), deletions: 0 };
  if (change.kind.type === "delete") return { additions: 0, deletions: countContentLines(change.diff) };

  let additions = 0;
  let deletions = 0;

  for (const line of change.diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }

  return { additions, deletions };
}

function countContentLines(content: string): number {
  if (!content) return 0;
  return content.split(/\r\n|\r|\n/).length - (/(?:\r\n|\r|\n)$/.test(content) ? 1 : 0);
}
