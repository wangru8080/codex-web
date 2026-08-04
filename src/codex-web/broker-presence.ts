import type { JsonRpcNotification } from "@/codex/protocol/json-rpc";

export const BROKER_PRESENCE_METHOD = "bridge/presence/updated";
export const BROKER_PRESENCE_LIST_METHOD = "bridge/presence/list";

export type BrokerOnlineUser = {
  id: string;
  email: string;
  osUser: string;
  connections: number;
  activeTurns: number;
};

export type BrokerPresenceListParams = {
  query?: string;
  limit?: number;
  cursor?: string | null;
};

export type ParsedBrokerPresenceListParams = {
  query: string;
  limit: number;
  cursor: string | null;
};

export type BrokerPresenceListResponse = {
  total: number;
  items: BrokerOnlineUser[];
  nextCursor: string | null;
};

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

export function parseBrokerPresenceListParams(params: unknown): ParsedBrokerPresenceListParams {
  if (params === undefined) return { query: "", limit: 50, cursor: null };
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new Error("在线账号分页参数必须是对象");
  }
  const values = params as BrokerPresenceListParams;
  if (values.query !== undefined && typeof values.query !== "string") {
    throw new Error("query 必须是字符串");
  }
  if (
    values.limit !== undefined
    && (!Number.isSafeInteger(values.limit) || values.limit < 1 || values.limit > 100)
  ) {
    throw new Error("limit 必须是 1 到 100 的整数");
  }
  if (values.cursor !== undefined && values.cursor !== null && typeof values.cursor !== "string") {
    throw new Error("cursor 必须是字符串或 null");
  }
  return {
    query: values.query?.trim().toLowerCase() ?? "",
    limit: values.limit ?? 50,
    cursor: values.cursor ?? null,
  };
}
