import type { JsonRpcNotification } from "@/codex/protocol/json-rpc";
import type { FileUpdateChange } from "@/codex/protocol/generated/v2/FileUpdateChange";
import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";
import type { TurnStatus } from "@/codex/protocol/generated/v2/TurnStatus";
import type { MessageContentBlock } from "@/types";
import {
  planProgressFromSteps,
  proposedPlanBlockFromText,
  updatedPlanBlockFromNotification,
} from "./plan-display-adapter";

export type AppServerTurnStatus = "idle" | "starting" | "running" | "completed" | "failed" | "interrupted";

export type AppServerRetryStatus = {
  message: string;
  additionalDetails: string | null;
};

export type AppServerTurnState = {
  status: AppServerTurnStatus;
  threadId: string;
  turnId: string;
  assistantText: string;
  assistantTextItemId: string | null;
  reasoningText: string;
  planText: string;
  latestProposedPlanMarkdown: string | null;
  planBlocks: MessageContentBlock[];
  taskProgress: { completed: number; total: number } | null;
  startedAtMs?: number;
  durationMs?: number;
  items: ThreadItem[];
  toolOutputs: Record<string, string>;
  turnDiff: string;
  filePatchChanges: Record<string, FileUpdateChange[]>;
  mcpProgress: Record<string, string>;
  contextCompactionStatusById: Record<string, "inProgress" | "completed">;
  errorMessage: string;
  errorSourceBreadcrumb: "app-server.turn/completed" | "app-server.error" | null;
  retryStatus: AppServerRetryStatus | null;
};

export const initialAppServerTurnState: AppServerTurnState = {
  status: "idle",
  threadId: "",
  turnId: "",
  assistantText: "",
  assistantTextItemId: null,
  reasoningText: "",
  planText: "",
  latestProposedPlanMarkdown: null,
  planBlocks: [],
  taskProgress: null,
  startedAtMs: undefined,
  durationMs: undefined,
  items: [],
  toolOutputs: {},
  turnDiff: "",
  filePatchChanges: {},
  mcpProgress: {},
  contextCompactionStatusById: {},
  errorMessage: "",
  errorSourceBreadcrumb: null,
  retryStatus: null,
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

export function createAcceptedTurnState(
  threadId: string,
  turnId: string,
  startedAtMs?: number,
): AppServerTurnState {
  return {
    ...initialAppServerTurnState,
    status: "running",
    threadId,
    turnId,
    startedAtMs,
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
    startedAtMs: current?.startedAtMs ?? accepted.startedAtMs,
  };
}

export function turnStartedAtMs(startedAt: unknown): number | undefined {
  const seconds = readFiniteNumber(startedAt);
  return seconds === undefined ? undefined : seconds * 1000;
}

export function hydrateTerminalTurn(
  current: AppServerTurnState,
  turn: {
    id: string;
    status: TurnStatus;
    items: ThreadItem[];
    startedAt: number | null;
    durationMs: number | null;
    error: unknown;
  },
): AppServerTurnState | null {
  if (current.turnId !== turn.id || !isTerminalTurnStatus(turn.status)) {
    return null;
  }
  let next = current;
  for (const item of turn.items) {
    next = reduceAppServerTurnNotification(next, {
      method: "item/completed",
      params: { threadId: current.threadId, turnId: turn.id, item },
    });
  }
  return reduceAppServerTurnNotification(next, {
    method: "turn/completed",
    params: { threadId: current.threadId, turn },
  });
}

export function reduceAppServerTurnNotification(
  state: AppServerTurnState,
  notification: JsonRpcNotification,
): AppServerTurnState {
  if (notification.method !== "error" && state.retryStatus) {
    state = { ...state, retryStatus: null };
  }
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
      const resolvedThreadId = typeof threadId === "string" ? threadId : state.threadId;
      if (
        state.threadId === resolvedThreadId &&
        state.turnId === turnId &&
        isTerminalTurnStatus(state.status)
      ) {
        return state;
      }
      const existingStartedAtMs =
        state.threadId === resolvedThreadId && state.turnId === turnId
          ? state.startedAtMs
          : undefined;
      return createAcceptedTurnState(
        resolvedThreadId,
        turnId,
        turnStartedAtMs(turn.startedAt) ?? existingStartedAtMs,
      );
    }

    case "item/started":
    case "item/completed": {
      const data = readRecord(params);
      const item = data.item;
      if (!isThreadItem(item)) return state;
      if (item.type === "contextCompaction") {
        return {
          ...state,
          items: upsertItem(state.items, item),
          contextCompactionStatusById: {
            ...state.contextCompactionStatusById,
            [item.id]: notification.method === "item/started" ? "inProgress" : "completed",
          },
        };
      }
      if (item.type === "plan") {
        const streamedPlan = state.planText.trim();
        const planText = item.text.trim() || streamedPlan;
        const completedBlock = proposedPlanBlockFromText(planText, "app-server.item/completed");
        return {
          ...state,
          items: upsertItem(state.items, item),
          planText,
          latestProposedPlanMarkdown: planText || state.latestProposedPlanMarkdown,
          planBlocks: completedBlock
            ? replaceLatestProposedPlanBlock(state.planBlocks, completedBlock)
            : state.planBlocks,
        };
      }
      const clearsAssistantText =
        item.type === "agentMessage" &&
        item.phase === "commentary" &&
        state.assistantTextItemId === item.id;
      return {
        ...state,
        items: upsertItem(state.items, item),
        assistantText:
          clearsAssistantText
            ? ""
            : item.type === "agentMessage" && item.phase !== "commentary"
            ? item.text
            : state.assistantText,
        assistantTextItemId:
          clearsAssistantText
            ? null
            : item.type === "agentMessage" && item.phase !== "commentary"
              ? item.id
              : state.assistantTextItemId,
      };
    }

    case "item/agentMessage/delta": {
      const data = readRecord(params);
      const delta = data.delta;
      const itemId = data.itemId;
      if (typeof delta !== "string" || typeof itemId !== "string") return state;
      const item = state.items.find(
        (candidate): candidate is Extract<ThreadItem, { type: "agentMessage" }> =>
          candidate.id === itemId && candidate.type === "agentMessage",
      );
      return {
        ...state,
        items: appendAgentMessageDelta(state.items, itemId, delta),
        assistantText:
          item?.phase === "commentary" ? state.assistantText : state.assistantText + delta,
        assistantTextItemId:
          item?.phase === "commentary" ? state.assistantTextItemId : itemId,
      };
    }

    case "item/plan/delta": {
      const data = readRecord(params);
      const delta = data.delta;
      if (typeof delta !== "string") return state;
      const planText = state.planText + delta;
      const block = proposedPlanBlockFromText(planText, "app-server.item/plan/delta");
      return {
        ...state,
        planText,
        planBlocks: block ? replaceLatestProposedPlanBlock(state.planBlocks, block) : state.planBlocks,
      };
    }

    case "turn/plan/updated": {
      const data = readRecord(params);
      const notification = {
        threadId: typeof data.threadId === "string" ? data.threadId : state.threadId,
        turnId: typeof data.turnId === "string" ? data.turnId : state.turnId,
        explanation: typeof data.explanation === "string" ? data.explanation : null,
        plan: Array.isArray(data.plan) ? data.plan.filter(isTurnPlanStep) : [],
      };
      const block = updatedPlanBlockFromNotification(notification, "app-server.turn/plan/updated");
      return {
        ...state,
        planBlocks: [...state.planBlocks, block],
        taskProgress: planProgressFromSteps(notification.plan),
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

    case "turn/diff/updated": {
      const diff = readRecord(params).diff;
      if (typeof diff !== "string") return state;
      return {
        ...state,
        turnDiff: diff,
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
        startedAtMs: turnStartedAtMs(turn.startedAt) ?? state.startedAtMs,
        durationMs: readFiniteNumber(turn.durationMs) ?? state.durationMs,
        errorMessage: readTurnErrorMessage(turn.error),
        errorSourceBreadcrumb: readTurnErrorMessage(turn.error) ? "app-server.turn/completed" : null,
      };
    }

    case "error": {
      const data = readRecord(params);
      const error = readRecord(data.error);
      const message = typeof error.message === "string"
        ? error.message
        : typeof data.message === "string"
          ? data.message
          : "app-server 返回错误";
      if (data.willRetry === true) {
        return {
          ...state,
          status: "running",
          errorMessage: "",
          retryStatus: {
            message,
            additionalDetails: typeof error.additionalDetails === "string"
              ? error.additionalDetails
              : null,
          },
        };
      }
      return {
        ...state,
        status: "failed",
        errorMessage: message,
        errorSourceBreadcrumb: "app-server.error",
        retryStatus: null,
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

function appendAgentMessageDelta(items: ThreadItem[], itemId: string, delta: string): ThreadItem[] {
  return items.map((item) =>
    item.id === itemId && item.type === "agentMessage"
      ? { ...item, text: item.text + delta }
      : item,
  );
}

function replaceLatestProposedPlanBlock(
  blocks: MessageContentBlock[],
  block: MessageContentBlock,
): MessageContentBlock[] {
  const index = blocks.findLastIndex((existing) => existing.type === "codex_proposed_plan");
  if (index === -1) return [...blocks, block];
  const next = [...blocks];
  next[index] = block;
  return next;
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

function isTurnPlanStep(value: unknown): value is { step: string; status: "pending" | "inProgress" | "completed" } {
  const data = readRecord(value);
  return (
    typeof data.step === "string" &&
    (data.status === "pending" || data.status === "inProgress" || data.status === "completed")
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
