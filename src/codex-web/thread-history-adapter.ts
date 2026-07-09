import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";
import type { Turn } from "@/codex/protocol/generated/v2/Turn";
import type { ChatSession, Message, MessageContentBlock } from "@/types";

const CODEX_PROVIDER_ID = "codex_account";
const CODEX_RUNTIME_PIN = "codex_runtime";

export type ThreadMessagesResult = {
  messages: Message[];
  unsupportedItemCount: number;
};

export function threadToChatSession(thread: Thread): ChatSession {
  const title = thread.name || thread.preview || "Codex 会话";
  const createdAt = secondsToIso(thread.createdAt);
  const updatedAt = secondsToIso(thread.updatedAt || thread.recencyAt || thread.createdAt);
  return {
    id: thread.id,
    title,
    created_at: createdAt,
    updated_at: updatedAt,
    model: "",
    system_prompt: "",
    working_directory: thread.cwd,
    sdk_session_id: "",
    codex_thread_id: thread.id,
    codex_home_session_id: thread.sessionId,
    codex_home_model_provider: thread.modelProvider,
    project_name: projectNameFromCwd(thread.cwd),
    source: "user",
    origin: "codex_rollout",
    read_only: true,
    codex_session_id: thread.id,
    model_provider: thread.modelProvider,
    status: "active",
    mode: "code",
    needs_approval: false,
    provider_name: "Codex",
    provider_id: CODEX_PROVIDER_ID,
    runtime_pin: CODEX_RUNTIME_PIN,
    sdk_cwd: thread.cwd,
    runtime_status: thread.status.type,
    runtime_updated_at: updatedAt,
    runtime_error: "",
    permission_profile: "request_approval",
  };
}

export function threadToMessages(thread: Thread): ThreadMessagesResult {
  const messages: Message[] = [];
  let unsupportedItemCount = 0;

  for (const turn of thread.turns) {
    const assistantBlocks: MessageContentBlock[] = [];
    let assistantMessageId: string | null = null;

    for (const item of turn.items) {
      if (item.type === "userMessage") {
        const message = userItemToMessage(thread, turn, item);
        if (message) messages.push(message);
        continue;
      }

      const blocks = assistantItemToBlocks(item);
      if (blocks.length > 0) {
        assistantMessageId ??= item.id;
        assistantBlocks.push(...blocks);
      } else if (isUnsupportedHistoryItem(item)) {
        unsupportedItemCount += 1;
      }
    }

    if (assistantBlocks.length > 0) {
      messages.push(
        createMessage(
          thread,
          turn,
          assistantMessageId ?? `${turn.id}-assistant-history`,
          "assistant",
          JSON.stringify(assistantBlocks),
        ),
      );
    }
  }

  return { messages, unsupportedItemCount };
}

function userItemToMessage(
  thread: Thread,
  turn: Turn,
  item: Extract<ThreadItem, { type: "userMessage" }>,
): Message | null {
  const content = item.content
    .map((input) => (input.type === "text" ? input.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (!content) return null;
  return createMessage(thread, turn, item.id, "user", content);
}

function assistantItemToBlocks(item: ThreadItem): MessageContentBlock[] {
  if (item.type === "agentMessage") {
    const text = item.text.trim();
    return text ? [{ type: "text", text }] : [];
  }

  if (item.type === "commandExecution") {
    const result = commandExecutionResult(item);
    return [
      {
        type: "tool_use",
        id: item.id,
        name: "bash",
        input: {
          command: item.command,
          cwd: item.cwd,
          source: item.source,
          actions: item.commandActions,
        },
      },
      ...(result
        ? [
            {
              type: "tool_result" as const,
              tool_use_id: item.id,
              content: result.content,
              is_error: result.isError,
            },
          ]
        : []),
    ];
  }

  if (item.type === "fileChange") {
    return [
      {
        type: "tool_use",
        id: item.id,
        name: "fileChange",
        input: {
          status: item.status,
          files: item.changes.map((change) => change.path),
          changes: item.changes,
        },
      },
      ...(item.status === "inProgress"
        ? []
        : [
            {
              type: "tool_result" as const,
              tool_use_id: item.id,
              content: formatFileChanges(item),
              is_error: item.status === "failed" || item.status === "declined",
            },
          ]),
    ];
  }

  if (item.type === "mcpToolCall") {
    return [
      {
        type: "tool_use",
        id: item.id,
        name: `mcp:${item.server}/${item.tool}`,
        input: {
          server: item.server,
          tool: item.tool,
          arguments: item.arguments,
          appContext: item.appContext,
        },
      },
      ...(item.status === "inProgress"
        ? []
        : [
            {
              type: "tool_result" as const,
              tool_use_id: item.id,
              content: formatMcpResult(item),
              is_error: item.status === "failed" || !!item.error,
            },
          ]),
    ];
  }

  return [];
}

function createMessage(
  thread: Thread,
  turn: Turn,
  itemId: string,
  role: "user" | "assistant",
  content: string,
): Message {
  return {
    id: itemId,
    session_id: thread.id,
    role,
    content,
    created_at: secondsToIso(role === "user" ? turn.startedAt : turn.completedAt || turn.startedAt),
    token_usage: null,
  };
}

function isUnsupportedHistoryItem(item: ThreadItem): boolean {
  return (
    item.type !== "userMessage" &&
    item.type !== "agentMessage" &&
    item.type !== "commandExecution" &&
    item.type !== "fileChange" &&
    item.type !== "mcpToolCall"
  );
}

function commandExecutionResult(
  item: Extract<ThreadItem, { type: "commandExecution" }>,
): { content: string; isError: boolean } | null {
  if (item.status === "inProgress") return null;
  const output = item.aggregatedOutput?.trimEnd() ?? "";
  const suffix = typeof item.exitCode === "number" ? `\nexit code: ${item.exitCode}` : "";
  return {
    content: `${output}${suffix}`.trim(),
    isError: item.status === "failed" || item.status === "declined" || (item.exitCode ?? 0) !== 0,
  };
}

function formatFileChanges(item: Extract<ThreadItem, { type: "fileChange" }>): string {
  const header = `${item.status}: ${item.changes.length} file${item.changes.length === 1 ? "" : "s"}`;
  const paths = item.changes
    .map((change) => `- ${formatChangeKind(change.kind)}: ${change.path}`)
    .join("\n");
  return [header, paths].filter(Boolean).join("\n");
}

function formatChangeKind(
  kind: Extract<ThreadItem, { type: "fileChange" }>["changes"][number]["kind"],
): string {
  if (kind.type === "update" && kind.move_path) return `update from ${kind.move_path}`;
  return kind.type;
}

function formatMcpResult(item: Extract<ThreadItem, { type: "mcpToolCall" }>): string {
  if (item.error?.message) return item.error.message;
  if (!item.result) return "";
  return stringifyJson(item.result.structuredContent ?? item.result.content);
}

function stringifyJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function secondsToIso(seconds: number | null): string {
  return new Date(Math.max(0, seconds ?? 0) * 1000).toISOString();
}

function projectNameFromCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd || "Codex";
}
