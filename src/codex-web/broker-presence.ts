import type { JsonRpcNotification } from "@/codex/protocol/json-rpc";

export const BROKER_PRESENCE_METHOD = "bridge/presence/updated";

export function brokerPresenceNotification(onlineUsers: number): JsonRpcNotification {
  return {
    method: BROKER_PRESENCE_METHOD,
    params: { onlineUsers },
  };
}

export function readBrokerPresence(notification: JsonRpcNotification): number | null {
  if (notification.method !== BROKER_PRESENCE_METHOD) return null;
  const params = notification.params;
  if (typeof params !== "object" || params === null || !("onlineUsers" in params)) return null;
  const onlineUsers = (params as { onlineUsers?: unknown }).onlineUsers;
  return Number.isSafeInteger(onlineUsers) && (onlineUsers as number) >= 0
    ? onlineUsers as number
    : null;
}
