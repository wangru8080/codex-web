import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";

import type { AppServerTurnState } from "./turn-reducer";
import {
  codexWebRunningOutputFromItem,
  codexWebToolResultFromItem,
  codexWebToolUseFromItem,
  type CodexWebToolResultInfo,
  type CodexWebToolUseInfo,
  type ToolItemContext,
} from "./tool-item-adapter";

export type { CodexWebToolResultInfo, CodexWebToolUseInfo };

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
    const context = toolContext(item, turn);
    const toolUse = codexWebToolUseFromItem(item, context);
    if (!toolUse) continue;

    toolUses.push(toolUse);

    const result = codexWebToolResultFromItem(item, context);
    if (result) {
      toolResults.push(result);
    } else {
      lastRunningToolOutput = codexWebRunningOutputFromItem(item, context);
    }
  }

  return {
    toolUses,
    toolResults,
    streamingToolOutput: lastRunningToolOutput,
  };
}

function toolContext(item: ThreadItem, turn: AppServerTurnState): ToolItemContext {
  if (item.type === "fileChange") {
    return {
      output: turn.toolOutputs[item.id],
      fileChanges: turn.filePatchChanges[item.id] ?? item.changes,
    };
  }

  if (item.type === "mcpToolCall") {
    return {
      mcpProgress: turn.mcpProgress[item.id],
    };
  }

  if (item.type === "commandExecution") {
    return {
      output: turn.toolOutputs[item.id],
    };
  }

  return {};
}
