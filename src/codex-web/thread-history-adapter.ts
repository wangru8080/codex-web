import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";
import type { Turn } from "@/codex/protocol/generated/v2/Turn";
import type { ChatSession, Message } from "@/types";

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
    for (const item of turn.items) {
      const message = itemToMessage(thread, turn, item);
      if (message) {
        messages.push(message);
      } else if (isUnsupportedHistoryItem(item)) {
        unsupportedItemCount += 1;
      }
    }
  }

  return { messages, unsupportedItemCount };
}

function itemToMessage(thread: Thread, turn: Turn, item: ThreadItem): Message | null {
  if (item.type === "userMessage") {
    const content = item.content
      .map((input) => (input.type === "text" ? input.text : ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (!content) return null;
    return createMessage(thread, turn, item.id, "user", content);
  }

  if (item.type === "agentMessage") {
    const content = item.text.trim();
    if (!content) return null;
    return createMessage(thread, turn, item.id, "assistant", content);
  }

  return null;
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
  return item.type !== "userMessage" && item.type !== "agentMessage";
}

function secondsToIso(seconds: number | null): string {
  return new Date(Math.max(0, seconds ?? 0) * 1000).toISOString();
}

function projectNameFromCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd || "Codex";
}
