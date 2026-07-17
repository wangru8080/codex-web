import type { McpServerStartupState } from "@/codex/protocol/generated/v2/McpServerStartupState";
import type { McpServerStatusUpdatedNotification } from "@/codex/protocol/generated/v2/McpServerStatusUpdatedNotification";
import type { Sourced } from "./app-server-state";

export type McpStartupByName = Record<string, Sourced<McpServerStatusUpdatedNotification>>;

export function reduceMcpStartupNotification(
  current: McpStartupByName,
  notification: { method: string; params?: unknown },
): McpStartupByName {
  if (notification.method !== "mcpServer/startupStatus/updated") return current;
  const params = readRecord(notification.params);
  if (typeof params.name !== "string" || !params.name || !isStartupState(params.status)) return current;
  const data: McpServerStatusUpdatedNotification = {
    threadId: typeof params.threadId === "string" ? params.threadId : null,
    name: params.name,
    status: params.status,
    error: typeof params.error === "string" ? params.error : null,
    failureReason: params.failureReason === "reauthenticationRequired" ? "reauthenticationRequired" : null,
  };
  return {
    ...current,
    [data.name]: {
      source: "app-server.mcpServer/startupStatus/updated",
      data,
    },
  };
}

function isStartupState(value: unknown): value is McpServerStartupState {
  return value === "starting" || value === "ready" || value === "failed" || value === "cancelled";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
