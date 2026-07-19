import type { JsonRpcNotification } from "@/codex/protocol/json-rpc";
import type { Message } from "@/types";

export const CROSS_CLIENT_USER_MESSAGE_METHOD = "bridge/sync/userMessage";

export type CrossClientUserMessage = {
  threadId: string;
  turnId: string;
  isNewThread: boolean;
  message: Message;
};

export type CrossClientUserMessageState = {
  byThreadId: Record<string, CrossClientUserMessage[]>;
  latest: CrossClientUserMessage | null;
};

export const initialCrossClientUserMessageState: CrossClientUserMessageState = {
  byThreadId: {},
  latest: null,
};

export function readCrossClientUserMessage(
  notification: JsonRpcNotification,
): CrossClientUserMessage | null {
  if (notification.method !== CROSS_CLIENT_USER_MESSAGE_METHOD || !isRecord(notification.params)) {
    return null;
  }

  const { threadId, turnId, isNewThread, message } = notification.params;
  if (
    typeof threadId !== "string" || !threadId ||
    typeof turnId !== "string" || !turnId ||
    typeof isNewThread !== "boolean" ||
    !isMessage(message) ||
    message.session_id !== threadId
  ) {
    return null;
  }

  return { threadId, turnId, isNewThread, message };
}

export function reduceCrossClientUserMessage(
  current: CrossClientUserMessageState,
  notification: JsonRpcNotification,
): CrossClientUserMessageState {
  const event = readCrossClientUserMessage(notification);
  if (!event) {
    return current;
  }

  const existing = current.byThreadId[event.threadId] ?? [];
  const messages = existing.some((entry) => entry.message.id === event.message.id)
    ? existing
    : [...existing, event].slice(-50);

  return {
    byThreadId: {
      ...current.byThreadId,
      [event.threadId]: messages,
    },
    latest: event,
  };
}

export function mergeCrossClientUserMessages(
  current: Message[],
  incoming: readonly CrossClientUserMessage[],
): Message[] {
  const knownIds = new Set(current.map((message) => message.id));
  const appended = incoming
    .map((event) => event.message)
    .filter((message) => {
      if (knownIds.has(message.id)) {
        return false;
      }
      knownIds.add(message.id);
      return true;
    });

  return appended.length > 0 ? [...current, ...appended] : current;
}

function isMessage(value: unknown): value is Message {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.session_id === "string" && value.session_id.length > 0 &&
    value.role === "user" &&
    typeof value.content === "string" &&
    typeof value.created_at === "string" && value.created_at.length > 0 &&
    (value.token_usage === null || typeof value.token_usage === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
