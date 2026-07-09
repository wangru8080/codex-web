import type { FileUpdateChange } from "@/codex/protocol/generated/v2/FileUpdateChange";
import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";

import type { AppServerTurnState } from "./turn-reducer";
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
}

export type CodexWebToolState = {
  toolUses: CodexWebToolUseInfo[];
  toolResults: CodexWebToolResultInfo[];
  streamingToolOutput: string;
};

export function deriveCodexWebToolState(turn: AppServerTurnState | null): CodexWebToolState {
  if (!turn) {
    return { toolUses: [], toolResults: [], streamingToolOutput: "" };
  }

  const toolUses: CodexWebToolUseInfo[] = [];
  const toolResults: CodexWebToolResultInfo[] = [];
  let lastRunningToolOutput = "";

  for (const item of turn.items) {
    const toolUse = toToolUse(item, turn);
    if (!toolUse) continue;

    toolUses.push(toolUse);

    const result = toToolResult(item, turn);
    if (result) {
      toolResults.push(result);
    } else {
      lastRunningToolOutput = readRunningOutput(item, turn);
    }
  }

  return {
    toolUses,
    toolResults,
    streamingToolOutput: lastRunningToolOutput,
  };
}

function toToolUse(item: ThreadItem, turn: AppServerTurnState): CodexWebToolUseInfo | null {
  if (item.type === "commandExecution") {
    return {
      id: item.id,
      name: "bash",
      input: {
        command: item.command,
        cwd: item.cwd,
        source: item.source,
        actions: item.commandActions,
      },
    };
  }

  if (item.type === "fileChange") {
    const changes = readFileChanges(item, turn);
    return {
      id: item.id,
      name: "fileChange",
      input: {
        status: item.status,
        files: changes.map((change) => change.path),
        changes,
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
      },
    };
  }

  return null;
}

function toToolResult(item: ThreadItem, turn: AppServerTurnState): CodexWebToolResultInfo | null {
  if (item.type === "commandExecution") {
    if (item.status === "inProgress") return null;
    const output = (item.aggregatedOutput ?? turn.toolOutputs[item.id] ?? "").trimEnd();
    const suffix = typeof item.exitCode === "number" ? `\nexit code: ${item.exitCode}` : "";
    const displayOutput = formatToolDisplayOutput(output, {
      sourceLabel: "app-server commandExecution item / diagnostics",
    });
    return {
      tool_use_id: item.id,
      content: `${displayOutput}${suffix}`.trim(),
      is_error: item.status === "failed" || item.status === "declined" || (item.exitCode ?? 0) !== 0,
    };
  }

  if (item.type === "fileChange") {
    if (item.status === "inProgress") return null;
    const changes = readFileChanges(item, turn);
    return {
      tool_use_id: item.id,
      content: formatToolDisplayOutput(formatFileChanges(item.status, changes, turn.toolOutputs[item.id]), {
        sourceLabel: "app-server fileChange item / diagnostics",
      }),
      is_error: item.status === "failed" || item.status === "declined",
    };
  }

  if (item.type === "mcpToolCall") {
    if (item.status === "inProgress") return null;
    return {
      tool_use_id: item.id,
      content: formatToolDisplayOutput(formatMcpResult(item), {
        sourceLabel: "app-server mcpToolCall item / diagnostics",
      }),
      is_error: item.status === "failed" || !!item.error,
    };
  }

  return null;
}

function readRunningOutput(item: ThreadItem, turn: AppServerTurnState): string {
  if (item.type === "commandExecution" || item.type === "fileChange") {
    return formatToolDisplayOutput(turn.toolOutputs[item.id] ?? "", {
      sourceLabel: "app-server 工具增量 diagnostics",
    });
  }
  if (item.type === "mcpToolCall") {
    return formatToolDisplayOutput(turn.mcpProgress[item.id]?.trimEnd() ?? "", {
      sourceLabel: "app-server MCP progress diagnostics",
    });
  }
  return "";
}

function readFileChanges(
  item: Extract<ThreadItem, { type: "fileChange" }>,
  turn: AppServerTurnState,
): FileUpdateChange[] {
  return turn.filePatchChanges[item.id] ?? item.changes;
}

function formatFileChanges(status: string, changes: FileUpdateChange[], output = ""): string {
  const header = `${status}: ${changes.length} file${changes.length === 1 ? "" : "s"}`;
  const paths = changes.map((change) => `- ${change.kind}: ${change.path}`).join("\n");
  return [header, paths, output.trim()].filter(Boolean).join("\n");
}

function formatMcpResult(item: Extract<ThreadItem, { type: "mcpToolCall" }>): string {
  if (item.error?.message) return item.error.message;
  if (!item.result) return "";
  return stringifyJson(item.result.structuredContent ?? item.result.content);
}

function stringifyJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
