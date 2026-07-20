import type { FileUpdateChange } from "@/codex/protocol/generated/v2/FileUpdateChange";
import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";
import type { MediaBlock } from "@/types";

import { mediaTypeForPath } from "./app-server-files";
import { formatToolDisplayOutput } from "./tool-output-display";

export interface CodexWebToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

export interface CodexWebToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  media?: MediaBlock[];
}

export type ToolItemContext = {
  output?: string;
  fileChanges?: FileUpdateChange[];
  mcpProgress?: string;
  sourceLabel?: string;
};

export function codexWebToolUseFromItem(
  item: ThreadItem,
  context: ToolItemContext = {},
): CodexWebToolUseInfo | null {
  if (item.type === "commandExecution") {
    return {
      id: item.id,
      name: "bash",
      input: {
        command: item.command,
        cwd: item.cwd,
        source: item.source,
        status: item.status,
        durationMs: item.durationMs,
        exitCode: item.exitCode,
        processId: item.processId,
        actions: item.commandActions,
        sourceBreadcrumb: "app-server.commandExecution",
      },
    };
  }

  if (item.type === "webSearch") {
    return {
      id: item.id,
      name: "web_search",
      input: {
        query: item.query,
        action: item.action,
        sourceBreadcrumb: "app-server.webSearch",
      },
    };
  }

  if (item.type === "imageView") {
    return {
      id: item.id,
      name: "view_image",
      input: {
        path: item.path,
        sourceBreadcrumb: "app-server.imageView",
      },
    };
  }

  if (item.type === "imageGeneration") {
    return {
      id: item.id,
      name: "image_generation",
      input: {
        status: item.status,
        revisedPrompt: item.revisedPrompt,
        savedPath: item.savedPath,
        sourceBreadcrumb: "app-server.imageGeneration",
      },
    };
  }

  if (item.type === "fileChange") {
    const changes = context.fileChanges ?? item.changes;
    return {
      id: item.id,
      name: "fileChange",
      input: {
        status: item.status,
        files: changes.map((change) => change.path),
        changes,
        sourceBreadcrumb: "app-server.fileChange",
      },
    };
  }

  if (item.type === "mcpToolCall") {
    return {
      id: item.id,
      name: `mcp:${item.server}/${item.tool}`,
      input: {
        server: item.server,
        tool: item.tool,
        arguments: item.arguments,
        appContext: item.appContext,
        pluginId: item.pluginId,
        status: item.status,
        durationMs: item.durationMs,
        sourceBreadcrumb: "app-server.mcpToolCall",
      },
    };
  }

  if (item.type === "dynamicToolCall") {
    return {
      id: item.id,
      name: item.namespace ? `dynamic:${item.namespace}/${item.tool}` : `dynamic:${item.tool}`,
      input: {
        namespace: item.namespace,
        tool: item.tool,
        arguments: item.arguments,
        status: item.status,
        success: item.success,
        durationMs: item.durationMs,
        sourceBreadcrumb: "app-server.dynamicToolCall",
      },
    };
  }

  if (item.type === "collabAgentToolCall") {
    return {
      id: item.id,
      name: `collab:${item.tool}`,
      input: {
        tool: item.tool,
        status: item.status,
        senderThreadId: item.senderThreadId,
        receiverThreadIds: item.receiverThreadIds,
        prompt: item.prompt,
        model: item.model,
        reasoningEffort: item.reasoningEffort,
        agentsStates: item.agentsStates,
        sourceBreadcrumb: "app-server.collabAgentToolCall",
      },
    };
  }

  return null;
}

export function codexWebToolResultFromItem(
  item: ThreadItem,
  context: ToolItemContext = {},
): CodexWebToolResultInfo | null {
  if (item.type === "commandExecution") {
    if (item.status === "inProgress") return null;

    return {
      tool_use_id: item.id,
      content: formatCommandExecutionResult(item, context),
      is_error:
        item.status === "failed" || item.status === "declined" || (item.exitCode ?? 0) !== 0,
    };
  }

  if (item.type === "webSearch") {
    if (!item.action) return null;
    return {
      tool_use_id: item.id,
      content: [
        `query: ${item.query}`,
        `action: ${formatWebSearchAction(item.action)}`,
        "source: app-server.webSearch",
      ].join("\n"),
      is_error: false,
    };
  }

  if (item.type === "imageView") {
    return {
      tool_use_id: item.id,
      content: [`path: ${item.path}`, "source: app-server.imageView"].join("\n"),
      is_error: false,
      media: [mediaFromPath(item.path)],
    };
  }

  if (item.type === "imageGeneration") {
    if (!item.status && !item.savedPath && !item.result) return null;

    const media = item.savedPath
      ? [mediaFromPath(item.savedPath)]
      : item.result
        ? [{ type: "image" as const, mimeType: "image/png", data: item.result }]
        : [];
    const failed = item.status.toLowerCase().includes("fail");
    return {
      tool_use_id: item.id,
      content: [
        `status: ${item.status || "completed"}`,
        item.revisedPrompt ? `revised prompt: ${item.revisedPrompt}` : "",
        item.savedPath ? `saved path: ${item.savedPath}` : "",
        "source: app-server.imageGeneration",
      ].filter(Boolean).join("\n"),
      is_error: failed,
      ...(media.length > 0 ? { media } : {}),
    };
  }

  if (item.type === "fileChange") {
    if (item.status === "inProgress") return null;

    return {
      tool_use_id: item.id,
      content: display(
        formatFileChanges(item.status, context.fileChanges ?? item.changes, context.output),
        context,
        "app-server fileChange item / diagnostics",
      ),
      is_error: item.status === "failed" || item.status === "declined",
    };
  }

  if (item.type === "mcpToolCall") {
    if (item.status === "inProgress") return null;

    const media = mediaFromMcpResult(item.result);
    return {
      tool_use_id: item.id,
      content: display(formatMcpResult(item), context, "app-server mcpToolCall item / diagnostics"),
      is_error: item.status === "failed" || !!item.error || mcpResultHasErrorContent(item.result),
      ...(media.length > 0 ? { media } : {}),
    };
  }

  if (item.type === "dynamicToolCall") {
    if (item.status === "inProgress") return null;

    const media = (item.contentItems ?? []).flatMap((contentItem) =>
      contentItem.type === "inputImage" ? mediaFromImageUrl(contentItem.imageUrl) : [],
    );
    return {
      tool_use_id: item.id,
      content: display(
        formatDynamicToolResult(item),
        context,
        "app-server dynamicToolCall item / diagnostics",
      ),
      is_error: item.status === "failed" || item.success === false,
      ...(media.length > 0 ? { media } : {}),
    };
  }

  if (item.type === "collabAgentToolCall") {
    if (item.status === "inProgress") return null;

    return {
      tool_use_id: item.id,
      content: display(
        formatCollabToolResult(item),
        context,
        "app-server collabAgentToolCall item / diagnostics",
      ),
      is_error: item.status === "failed",
    };
  }

  return null;
}

export function codexWebRunningOutputFromItem(
  item: ThreadItem,
  context: ToolItemContext = {},
): string {
  if (item.type === "commandExecution" || item.type === "fileChange") {
    return display(context.output ?? "", context, "app-server 工具增量 diagnostics");
  }
  if (item.type === "mcpToolCall") {
    return display(context.mcpProgress?.trimEnd() ?? "", context, "app-server MCP progress diagnostics");
  }
  return "";
}

function display(output: string, context: ToolItemContext, fallbackSourceLabel: string): string {
  return formatToolDisplayOutput(output, {
    sourceLabel: context.sourceLabel ?? fallbackSourceLabel,
  });
}

function formatCommandExecutionResult(
  item: Extract<ThreadItem, { type: "commandExecution" }>,
  context: ToolItemContext,
): string {
  const output = (item.aggregatedOutput ?? context.output ?? "").trimEnd();
  const displayOutput = display(output, context, "app-server commandExecution item / diagnostics");
  return [
    displayOutput,
    `status: ${item.status}`,
    typeof item.exitCode === "number" ? `exit code: ${item.exitCode}` : "",
    typeof item.durationMs === "number" ? `duration: ${item.durationMs}ms` : "",
    "source: app-server.commandExecution",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatFileChanges(status: string, changes: FileUpdateChange[], output = ""): string {
  const header = `${status}: ${changes.length} file${changes.length === 1 ? "" : "s"}`;
  const paths = changes
    .map((change) => `- ${formatChangeKind(change.kind)}: ${change.path}`)
    .join("\n");
  return [header, paths, output.trim(), "source: app-server.fileChange"]
    .filter(Boolean)
    .join("\n");
}

function formatChangeKind(kind: FileUpdateChange["kind"]): string {
  if (kind.type === "update" && kind.move_path) return `update from ${kind.move_path}`;
  return kind.type;
}

function formatMcpResult(item: Extract<ThreadItem, { type: "mcpToolCall" }>): string {
  if (item.error?.message) return item.error.message;

  const resultText = item.result
    ? item.result.structuredContent !== null
      ? stringifyJson(item.result.structuredContent)
      : formatMcpContent(item.result.content)
    : "";
  return [
    resultText,
    `status: ${item.status}`,
    typeof item.durationMs === "number" ? `duration: ${item.durationMs}ms` : "",
    "source: app-server.mcpToolCall",
  ]
    .filter(Boolean)
    .join("\n");
}

function mcpResultHasErrorContent(
  result: Extract<ThreadItem, { type: "mcpToolCall" }>["result"],
): boolean {
  if (!result) return false;

  return result.content.some((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return false;

    const data = block as Record<string, unknown>;
    return data.is_error === true || data.isError === true;
  });
}

function formatDynamicToolResult(item: Extract<ThreadItem, { type: "dynamicToolCall" }>): string {
  const content = (item.contentItems ?? []).map((contentItem) =>
    contentItem.type === "inputText" ? contentItem.text : "[图片输出]",
  ).join("\n");
  return [
    content,
    `status: ${item.status}`,
    item.success === null ? "" : `success: ${item.success}`,
    typeof item.durationMs === "number" ? `duration: ${item.durationMs}ms` : "",
    "source: app-server.dynamicToolCall",
  ]
    .filter(Boolean)
    .join("\n");
}

function mediaFromPath(path: string): MediaBlock {
  return { type: "image", mimeType: mediaTypeForPath(path), localPath: path };
}

function mediaFromImageUrl(imageUrl: string): MediaBlock[] {
  const dataUrl = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(imageUrl);
  if (dataUrl) {
    return [{ type: "image", mimeType: dataUrl[1], data: dataUrl[2] }];
  }
  if (/^https?:\/\//i.test(imageUrl)) {
    return [{ type: "image", mimeType: "image/*", url: imageUrl }];
  }
  return [];
}

function mediaFromMcpResult(
  result: Extract<ThreadItem, { type: "mcpToolCall" }>["result"],
): MediaBlock[] {
  if (!result) return [];

  return result.content.flatMap((content): MediaBlock[] => {
    if (!content || typeof content !== "object" || Array.isArray(content)) return [];
    const block = content as Record<string, unknown>;
    if (block.type === "image" && typeof block.data === "string") {
      const mimeType = typeof block.mimeType === "string"
        ? block.mimeType
        : typeof block.mime_type === "string"
          ? block.mime_type
          : "image/png";
      return [{ type: "image", mimeType, data: block.data }];
    }
    if (block.type === "image_url") {
      const imageUrl = typeof block.url === "string"
        ? block.url
        : typeof block.image_url === "string"
          ? block.image_url
          : "";
      return mediaFromImageUrl(imageUrl);
    }
    return [];
  });
}

function formatMcpContent(content: readonly unknown[]): string {
  return content.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return stringifyJson(value);
    const block = value as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") return block.text;
    if (block.type === "image" || block.type === "image_url") return "[图片输出]";
    return stringifyJson(value);
  }).filter(Boolean).join("\n");
}

function formatCollabToolResult(item: Extract<ThreadItem, { type: "collabAgentToolCall" }>): string {
  const agentLines = Object.entries(item.agentsStates)
    .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1]))
    .map(([threadId, state]) => `${threadId}: ${state.status}${state.message ? ` - ${state.message}` : ""}`);

  return [
    `status: ${item.status}`,
    `sender: ${item.senderThreadId}`,
    item.receiverThreadIds.length > 0 ? `receivers: ${item.receiverThreadIds.join(", ")}` : "",
    ...agentLines,
    "source: app-server.collabAgentToolCall",
  ]
    .filter(Boolean)
    .join("\n");
}

function stringifyJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatWebSearchAction(
  action: Extract<ThreadItem, { type: "webSearch" }>["action"] & {},
): string {
  if (action.type === "search") {
    return action.query || action.queries?.join(", ") || "search";
  }
  if (action.type === "openPage") return action.url || "openPage";
  if (action.type === "findInPage") {
    return [action.pattern, action.url].filter(Boolean).join(" in ") || "findInPage";
  }
  return "other";
}
