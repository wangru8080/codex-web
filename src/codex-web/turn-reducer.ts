import type { JsonRpcNotification } from "@/codex/protocol/json-rpc";
import type { FileUpdateChange } from "@/codex/protocol/generated/v2/FileUpdateChange";
import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";
import type { TurnStatus } from "@/codex/protocol/generated/v2/TurnStatus";

export type AppServerTurnStatus = "idle" | "starting" | "running" | "completed" | "failed" | "interrupted";

export type AppServerTurnState = {
  status: AppServerTurnStatus;
  threadId: string;
  turnId: string;
  assistantText: string;
  reasoningText: string;
  durationMs?: number;
  items: ThreadItem[];
  toolOutputs: Record<string, string>;
  filePatchChanges: Record<string, FileUpdateChange[]>;
  mcpProgress: Record<string, string>;
  errorMessage: string;
};

export const initialAppServerTurnState: AppServerTurnState = {
  status: "idle",
  threadId: "",
  turnId: "",
  assistantText: "",
  reasoningText: "",
  durationMs: undefined,
  items: [],
  toolOutputs: {},
  filePatchChanges: {},
  mcpProgress: {},
  errorMessage: "",
};

export function appServerTurnSnapshotKey(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`;
}

export function createStartingTurnState(): AppServerTurnState {
  return {
    ...initialAppServerTurnState,
    status: "starting",
  };
}

export function createAcceptedTurnState(threadId: string, turnId: string): AppServerTurnState {
  return {
    ...initialAppServerTurnState,
    status: "running",
    threadId,
    turnId,
  };
}

export function mergeAcceptedTurnState(
  current: AppServerTurnState | undefined,
  accepted: AppServerTurnState,
): AppServerTurnState {
  if (
    current &&
    current.threadId === accepted.threadId &&
    current.turnId === accepted.turnId &&
    isTerminalTurnStatus(current.status)
  ) {
    return current;
  }

  return {
    ...(current ?? accepted),
    threadId: accepted.threadId,
    turnId: accepted.turnId,
    status: "running",
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

    case "item/reasoning/summaryTextDelta": {
      const data = readRecord(params);
      const delta = data.delta;
      if (typeof delta !== "string") return state;
      return {
        ...state,
        reasoningText: state.reasoningText + delta,
      };
    }

    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta": {
      const data = readRecord(params);
      const itemId = data.itemId;
      const delta = data.delta;
      if (typeof itemId !== "string" || typeof delta !== "string") return state;
      return {
        ...state,
        toolOutputs: appendRecordText(state.toolOutputs, itemId, delta),
      };
    }

    case "item/fileChange/patchUpdated": {
      const data = readRecord(params);
      const itemId = data.itemId;
      const changes = data.changes;
      if (typeof itemId !== "string" || !Array.isArray(changes)) return state;
      return {
        ...state,
        filePatchChanges: {
          ...state.filePatchChanges,
          [itemId]: changes.filter(isFileUpdateChange),
        },
      };
    }

    case "item/mcpToolCall/progress": {
      const data = readRecord(params);
      const itemId = data.itemId;
      const message = data.message;
      if (typeof itemId !== "string" || typeof message !== "string") return state;
      return {
        ...state,
        mcpProgress: appendRecordText(state.mcpProgress, itemId, `${message}\n`),
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
        durationMs: readFiniteNumber(turn.durationMs) ?? state.durationMs,
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
  if (isTerminalTurnStatus(status)) {
    return status;
  }
  return "running";
}

function isTerminalTurnStatus(status: unknown): status is "completed" | "failed" | "interrupted" {
  return status === "completed" || status === "failed" || status === "interrupted";
}

function readTurnErrorMessage(error: unknown): string {
  const data = readRecord(error);
  return typeof data.message === "string" ? data.message : "";
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

function appendRecordText(record: Record<string, string>, key: string, text: string): Record<string, string> {
  return {
    ...record,
    [key]: (record[key] ?? "") + text,
  };
}

function isThreadItem(value: unknown): value is ThreadItem {
  const data = readRecord(value);
  return typeof data.id === "string" && typeof data.type === "string";
}

function isFileUpdateChange(value: unknown): value is FileUpdateChange {
  const data = readRecord(value);
  const kind = readRecord(data.kind);
  return typeof data.path === "string" && typeof kind.type === "string" && typeof data.diff === "string";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
