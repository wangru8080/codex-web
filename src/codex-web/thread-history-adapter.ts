import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";
import type { Turn } from "@/codex/protocol/generated/v2/Turn";
import type { ChatSession, FileAttachment, Message } from "@/types";

import { turnItemsToMessageContent } from "./app-server-message-blocks";

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
    let assistantMessageId: string | null = null;

    for (const item of turn.items) {
      if (item.type === "userMessage") {
        const message = userItemToMessage(thread, turn, item);
        if (message) messages.push(message);
        continue;
      }

      if (isSupportedAssistantItem(item)) {
        assistantMessageId ??= item.id;
      } else if (isUnsupportedHistoryItem(item)) {
        unsupportedItemCount += 1;
      }
    }

    if (assistantMessageId) {
      messages.push(
        createMessage(
          thread,
          turn,
          assistantMessageId ?? `${turn.id}-assistant-history`,
          "assistant",
          turnItemsToMessageContent({
            items: turn.items,
            durationMs: turn.durationMs ?? undefined,
          }),
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
  const rawContent = item.content
    .map((input) => (input.type === "text" ? input.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const parsedPrompt = parseFilesMentionedPrompt(rawContent, item.id);
  const files = userInputAttachments(item, parsedPrompt.files);
  const content = parsedPrompt.content;
  if (!content && files.length === 0) return null;
  const contentWithFiles = files.length > 0
    ? `<!--files:${JSON.stringify(files)}-->${content}`
    : content;
  return createMessage(thread, turn, item.id, "user", contentWithFiles);
}

function userInputAttachments(
  item: Extract<ThreadItem, { type: "userMessage" }>,
  promptFiles: FileAttachment[],
): FileAttachment[] {
  const files = promptFiles.map((file) => ({ ...file }));
  let imageSequence = 0;

  for (const input of item.content) {
    if (input.type === "image") {
      const parsed = parseImageDataUrl(input.url);
      const existing = files.find((file) => file.type.startsWith("image/") && !file.data);
      if (existing) {
        existing.type = parsed.type;
        existing.size = base64DecodedSize(parsed.data);
        existing.data = parsed.data;
      } else {
        files.push({
          id: `${item.id}-image-${imageSequence}`,
          name: `image-${imageSequence + 1}.${extensionForMimeType(parsed.type)}`,
          type: parsed.type,
          size: base64DecodedSize(parsed.data),
          data: parsed.data,
        });
      }
      imageSequence += 1;
    } else if (input.type === "localImage") {
      const name = input.path.split(/[\\/]/).pop() || `image-${files.length + 1}`;
      if (!files.some((file) => file.filePath === input.path)) {
        files.push({
          id: `${item.id}-image-${imageSequence}`,
          name,
          type: mimeTypeForName(name),
          size: 0,
          data: "",
          filePath: input.path,
        });
      }
      imageSequence += 1;
    }
  }

  return files;
}

function parseFilesMentionedPrompt(
  text: string,
  itemId: string,
): { content: string; files: FileAttachment[] } {
  const header = "# Files mentioned by the user:\n\n";
  const requestMarker = "\n\n## My request for Codex:\n";
  if (!text.startsWith(header)) return { content: text, files: [] };

  const markerIndex = text.indexOf(requestMarker, header.length);
  if (markerIndex < 0) return { content: text, files: [] };
  const entries = text.slice(header.length, markerIndex).split("\n\n");
  const files: FileAttachment[] = [];

  for (const [index, entry] of entries.entries()) {
    const match = entry.match(/^## (.+): ((?:\/|[A-Za-z]:[\\/]).+)$/);
    if (!match) return { content: text, files: [] };
    const name = match[1] ?? "attachment";
    const filePath = match[2] ?? "";
    files.push({
      id: `${itemId}-file-${index}`,
      name,
      type: mimeTypeForName(name),
      size: 0,
      data: "",
      filePath,
    });
  }

  if (files.length === 0) return { content: text, files: [] };
  return {
    content: text.slice(markerIndex + requestMarker.length).trim(),
    files,
  };
}

function parseImageDataUrl(url: string): { type: string; data: string } {
  const match = url.match(/^data:([^;,]+);base64,([\s\S]*)$/i);
  if (!match) return { type: "image/*", data: "" };
  return { type: match[1] || "image/*", data: match[2] || "" };
}

function base64DecodedSize(data: string): number {
  if (!data) return 0;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(data.length * 3 / 4) - padding);
}

function mimeTypeForName(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "svg": return "image/svg+xml";
    case "png": return "image/png";
    case "md":
    case "markdown": return "text/markdown";
    case "txt": return "text/plain";
    case "csv": return "text/csv";
    case "json": return "application/json";
    case "pdf": return "application/pdf";
    case "zip": return "application/zip";
    default: return "application/octet-stream";
  }
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    default: return "png";
  }
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

function isSupportedAssistantItem(item: ThreadItem): boolean {
  return (
    (item.type === "agentMessage" && item.text.trim().length > 0) ||
    (item.type === "plan" && item.text.trim().length > 0) ||
    item.type === "reasoning" ||
    item.type === "commandExecution" ||
    item.type === "webSearch" ||
    item.type === "fileChange" ||
    item.type === "mcpToolCall" ||
    item.type === "dynamicToolCall" ||
    item.type === "collabAgentToolCall"
  );
}

function isUnsupportedHistoryItem(item: ThreadItem): boolean {
  return (
    item.type !== "userMessage" &&
    item.type !== "agentMessage" &&
    item.type !== "plan" &&
    item.type !== "reasoning" &&
    item.type !== "webSearch" &&
    item.type !== "commandExecution" &&
    item.type !== "fileChange" &&
    item.type !== "mcpToolCall" &&
    item.type !== "dynamicToolCall" &&
    item.type !== "collabAgentToolCall"
  );
}

function secondsToIso(seconds: number | null): string {
  return new Date(Math.max(0, seconds ?? 0) * 1000).toISOString();
}

function projectNameFromCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd || "Codex";
}
