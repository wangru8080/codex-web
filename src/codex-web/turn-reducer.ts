import type { JsonRpcNotification } from "@/codex/protocol/json-rpc";
import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";
import type { TurnStatus } from "@/codex/protocol/generated/v2/TurnStatus";

export type AppServerTurnStatus = "idle" | "starting" | "running" | "completed" | "failed" | "interrupted";

export type AppServerTurnState = {
  status: AppServerTurnStatus;
  threadId: string;
  turnId: string;
  assistantText: string;
  items: ThreadItem[];
  errorMessage: string;
};

export const initialAppServerTurnState: AppServerTurnState = {
  status: "idle",
  threadId: "",
  turnId: "",
  assistantText: "",
  items: [],
  errorMessage: "",
};

export function createStartingTurnState(): AppServerTurnState {
  return {
    ...initialAppServerTurnState,
    status: "starting",
  };
}

export function reduceAppServerTurnNotification(
  state: AppServerTurnState,
  notification: JsonRpcNotification,
): AppServerTurnState {
  const params = notification.params;

  switch (notification.method) {
    case "thread/started": {
      const thread = readRecord(params).thread;
      const threadId = readRecord(thread).id;
      if (typeof threadId !== "string") return state;
      return {
        ...state,
        threadId,
      };
    }

    case "turn/started": {
      const data = readRecord(params);
      const turn = readRecord(data.turn);
      const turnId = turn.id;
      const threadId = data.threadId;
      if (typeof turnId !== "string") return state;
      return {
        ...state,
        status: "running",
        threadId: typeof threadId === "string" ? threadId : state.threadId,
        turnId,
      };
    }

    case "item/started":
    case "item/completed": {
      const data = readRecord(params);
      const item = data.item;
      if (!isThreadItem(item)) return state;
      return {
        ...state,
        items: upsertItem(state.items, item),
        assistantText: item.type === "agentMessage" ? item.text : state.assistantText,
      };
    }

    case "item/agentMessage/delta": {
      const data = readRecord(params);
      const delta = data.delta;
      if (typeof delta !== "string") return state;
      return {
        ...state,
        assistantText: state.assistantText + delta,
      };
    }

    case "turn/completed": {
      const data = readRecord(params);
      const turn = readRecord(data.turn);
      const status = normalizeTurnStatus(turn.status);
      return {
        ...state,
        status,
        threadId: typeof data.threadId === "string" ? data.threadId : state.threadId,
        turnId: typeof turn.id === "string" ? turn.id : state.turnId,
        errorMessage: readTurnErrorMessage(turn.error),
      };
    }

    case "error": {
      const data = readRecord(params);
      const message = data.message;
      return {
        ...state,
        status: "failed",
        errorMessage: typeof message === "string" ? message : "app-server 返回错误",
      };
    }

    default:
      return state;
  }
}

function normalizeTurnStatus(status: unknown): AppServerTurnStatus {
  if (status === "completed" || status === "failed" || status === "interrupted") {
    return status;
  }
  return "running";
}

function readTurnErrorMessage(error: unknown): string {
  const data = readRecord(error);
  return typeof data.message === "string" ? data.message : "";
}

function upsertItem(items: ThreadItem[], item: ThreadItem): ThreadItem[] {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) {
    return [...items, item];
  }
  const next = [...items];
  next[index] = item;
  return next;
}

function isThreadItem(value: unknown): value is ThreadItem {
  const data = readRecord(value);
  return typeof data.id === "string" && typeof data.type === "string";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

