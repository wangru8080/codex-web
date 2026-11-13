import type { JsonRpcMessage } from "../src/codex/protocol/json-rpc";

export type CodexPushKind =
  | "turn_completed"
  | "turn_failed"
  | "goal_completed"
  | "approval_required"
  | "question_required"
  | "test";

export type CodexPushPayload = {
  version: 1;
  kind: CodexPushKind;
  title: string;
  body: string;
  threadId: string | null;
  turnId: string | null;
  requestId: string | null;
  source: string;
  createdAt: number;
};

export type CodexPushNotification = {
  dedupeKey: string;
  payload: CodexPushPayload;
};

type NotificationInput = Omit<CodexPushPayload, "version" | "createdAt"> & {
  dedupeKey: string;
  now: number;
};

type NotificationOptions = {
  threadName?: string;
  previousGoalStatus?: string;
  now?: number;
};

const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 240;

export function notificationFromAppServerMessage(
  message: JsonRpcMessage,
  options: NotificationOptions = {},
): CodexPushNotification | null {
  if (!("method" in message)) return null;
  const method = message.method;
  const params = asObject(message.params);
  if (!params) return null;
  const now = options.now ?? Date.now();

  if (method === "turn/completed") {
    const threadId = readString(params, "threadId");
    const turn = asObject(params.turn);
    const turnId = turn ? readString(turn, "id") : null;
    const status = turn ? readString(turn, "status") : null;
    if (!threadId || !turn || !turnId || (status !== "completed" && status !== "failed")) return null;
    const text = status === "completed"
      ? finalAgentMessageText(turn)
      : readString(asObject(turn.error), "message") ?? "";
    const label = options.threadName?.trim();
    const title = status === "completed"
      ? label ? `${label} finished` : "Codex turn completed"
      : label ? `${label} failed` : "Codex turn failed";
    const body = status === "completed"
      ? text || "Open Codex Web to review the completed turn."
      : text || "Open Codex Web to review the error.";
    return notification({
      kind: status === "completed" ? "turn_completed" : "turn_failed",
      title,
      body,
      threadId,
      turnId,
      requestId: null,
      source: `app-server.${method}`,
      now,
      dedupeKey: `turn:${threadId}:${turnId}:${status}`,
    });
  }

  if (method === "thread/goal/updated") {
    const goal = asObject(params.goal);
    const threadId = readString(params, "threadId") ?? (goal ? readString(goal, "threadId") : null);
    const status = goal ? readString(goal, "status") : null;
    if (!threadId || !goal || status !== "complete" || options.previousGoalStatus === "complete") {
      return null;
    }
    const objective = readString(goal, "objective") ?? "Goal";
    return notification({
      kind: "goal_completed",
      title: "Goal achieved",
      body: `${objective} is complete.`,
      threadId,
      turnId: readString(params, "turnId"),
      requestId: null,
      source: "app-server.thread/goal/updated",
      now,
      dedupeKey: `goal:${threadId}:complete`,
    });
  }

  if (message.id === undefined) return null;
  const requestId = String(message.id);
  const request = requestNotification(method, params);
  if (!request) return null;
  return notification({
    ...request,
    threadId: readString(params, "threadId"),
    turnId: readString(params, "turnId"),
    requestId,
    source: `app-server.${method}`,
    now,
    dedupeKey: `request:${method}:${requestId}`,
  });
}

function requestNotification(
  method: string,
  params: Record<string, unknown>,
): Pick<CodexPushPayload, "kind" | "title" | "body"> | null {
  if (method === "item/tool/requestUserInput") {
    const first = Array.isArray(params.questions) ? asObject(params.questions[0]) : null;
    return {
      kind: "question_required",
      title: "Codex needs your input",
      body: cleanText(
        (first && (readString(first, "question") ?? readString(first, "header")))
          ?? "Open Codex Web to answer the pending question.",
      ),
    };
  }

  if (method === "mcpServer/elicitation/request") {
    return {
      kind: "question_required",
      title: "MCP server needs your input",
      body: cleanText(
        readString(params, "message") ?? "Open Codex Web to respond to the MCP server.",
      ),
    };
  }

  if (
    method === "item/commandExecution/requestApproval"
    || method === "item/fileChange/requestApproval"
    || method === "item/permissions/requestApproval"
    || method === "applyPatchApproval"
    || method === "execCommandApproval"
    || method.includes("requestApproval")
  ) {
    const detail = readString(params, "reason")
      ?? readString(params, "command")
      ?? readString(params, "grantRoot")
      ?? readString(params, "cwd");
    return {
      kind: "approval_required",
      title: "Codex needs permission",
      body: cleanText(detail ?? "Open Codex Web to review the pending approval."),
    };
  }

  if (method.includes("requestUserInput") || method.includes("elicitation")) {
    return {
      kind: "question_required",
      title: "Codex needs your input",
      body: cleanText(
        readString(params, "message")
          ?? readString(params, "question")
          ?? "Open Codex Web to answer the pending question.",
      ),
    };
  }

  return null;
}

function notification(
  input: NotificationInput,
): CodexPushNotification {
  return {
    dedupeKey: input.dedupeKey,
    payload: {
      version: 1,
      kind: input.kind,
      title: cleanText(input.title, MAX_TITLE_LENGTH),
      body: cleanText(input.body, MAX_BODY_LENGTH),
      threadId: input.threadId,
      turnId: input.turnId,
      requestId: input.requestId,
      source: input.source,
      createdAt: input.now,
    },
  };
}

function finalAgentMessageText(turn: Record<string, unknown>): string {
  if (!Array.isArray(turn.items)) return "";
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = asObject(turn.items[index]);
    if (!item || readString(item, "type") !== "agentMessage") continue;
    const text = readString(item, "text")?.trim();
    if (text) return text;
  }
  return "";
}

function cleanText(value: string, maxLength = MAX_BODY_LENGTH): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: Record<string, unknown> | null, key: string): string | null {
  const field = value?.[key];
  return typeof field === "string" ? field : null;
}
