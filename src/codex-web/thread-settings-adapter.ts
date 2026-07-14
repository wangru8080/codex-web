import type { ThreadSettings } from "@/codex/protocol/generated/v2/ThreadSettings";
import type { JsonRpcNotification } from "@/codex/protocol/json-rpc";
import type { Sourced } from "./app-server-state";

export function reduceThreadSettingsNotification(
  current: Record<string, Sourced<ThreadSettings>>,
  notification: JsonRpcNotification,
): Record<string, Sourced<ThreadSettings>> {
  if (notification.method !== "thread/settings/updated") return current;
  const params = notification.params as { threadId?: string; threadSettings?: ThreadSettings } | undefined;
  if (!params?.threadId || !params.threadSettings) return current;
  return {
    ...current,
    [params.threadId]: { source: "app-server.notification", data: params.threadSettings },
  };
}
