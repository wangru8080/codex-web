import type { FsChangedNotification } from "@/codex/protocol/generated/v2/FsChangedNotification";
import type { JsonRpcNotification } from "@/codex/protocol/json-rpc";

export function readMatchingFsChangedPaths(
  notification: JsonRpcNotification,
  watchId: string,
): string[] | null {
  if (notification.method !== "fs/changed") return null;
  const params = notification.params as Partial<FsChangedNotification> | undefined;
  if (params?.watchId !== watchId || !Array.isArray(params.changedPaths)) return null;
  if (!params.changedPaths.every((path) => typeof path === "string")) return null;
  return [...params.changedPaths];
}
