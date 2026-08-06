import type { FileUpdateChange } from "@/codex/protocol/generated/v2/FileUpdateChange";
import type { ThreadItem } from "@/codex/protocol/generated/v2/ThreadItem";
import type { MessageContentBlock } from "@/types";

import type { AppServerTurnState } from "./turn-reducer";
import {
  codexWebToolResultFromItem,
  codexWebToolUseFromItem,
  type ToolItemContext,
} from "./tool-item-adapter";
import { proposedPlanBlockFromText } from "./plan-display-adapter";

type TurnItemsToMessageContentArgs = {
  items: ThreadItem[];
  assistantText?: string;
  durationMs?: number;
  interrupted?: boolean;
  errorMessage?: string;
  errorSourceBreadcrumb?: "app-server.turn/completed" | "app-server.error";
  reasoningText?: string;
  planBlocks?: MessageContentBlock[];
  toolOutputs?: Record<string, string>;
  filePatchChanges?: Record<string, FileUpdateChange[]>;
  mcpProgress?: Record<string, string>;
  contextCompactionStatusById?: Record<string, "inProgress" | "completed">;
};

export function appServerTurnToMessageContent(turn: AppServerTurnState): string {
  return turnItemsToMessageContent({
    items: turn.items,
    assistantText: turn.assistantText,
    durationMs: turn.durationMs,
    interrupted: turn.status === "interrupted",
    errorMessage: turn.status === "failed" ? turn.errorMessage : undefined,
    errorSourceBreadcrumb: turn.errorSourceBreadcrumb ?? undefined,
    reasoningText: turn.reasoningText,
    planBlocks: turn.planBlocks,
    toolOutputs: turn.toolOutputs,
    filePatchChanges: turn.filePatchChanges,
    mcpProgress: turn.mcpProgress,
    contextCompactionStatusById: turn.contextCompactionStatusById,
  });
}

export function appServerTerminalTurnToMessageContent(
  turn: AppServerTurnState,
): string | null {
  if (turn.status !== "completed" && turn.status !== "failed" && turn.status !== "interrupted") return null;
  if (
    !turn.assistantText.trim() &&
    !turn.reasoningText.trim() &&
    turn.items.length === 0 &&
    turn.planBlocks.length === 0 &&
    !turn.errorMessage.trim() &&
    turn.status !== "interrupted"
  ) {
    return null;
  }
  return appServerTurnToMessageContent(turn);
}

export function appServerTurnToMessageBlocks(turn: AppServerTurnState): MessageContentBlock[] {
  return turnItemsToMessageBlocks({
    items: turn.items,
    assistantText: turn.assistantText,
    durationMs: turn.durationMs,
    interrupted: turn.status === "interrupted",
    errorMessage: turn.status === "failed" ? turn.errorMessage : undefined,
    errorSourceBreadcrumb: turn.errorSourceBreadcrumb ?? undefined,
    reasoningText: turn.reasoningText,
    planBlocks: turn.planBlocks,
    toolOutputs: turn.toolOutputs,
    filePatchChanges: turn.filePatchChanges,
    mcpProgress: turn.mcpProgress,
    contextCompactionStatusById: turn.contextCompactionStatusById,
  });
}

export function turnItemsToMessageContent(args: TurnItemsToMessageContentArgs): string {
  const blocks = turnItemsToMessageBlocks(args);
  const hasProcessBlocks = blocks.some(
    (block) =>
      block.type === "thinking" ||
      block.type === "codex_interrupted" ||
      block.type === "codex_process_text" ||
      block.type === "codex_context_compaction" ||
      block.type === "codex_proposed_plan" ||
      block.type === "codex_updated_plan" ||
      block.type === "tool_use" ||
      block.type === "tool_result",
  );
  const finalOnlyText =
    blocks.length === 1 && blocks[0]?.type === "text" ? blocks[0].text.trim() : "";

  if (!hasProcessBlocks && finalOnlyText) {
    return finalOnlyText;
  }

  return JSON.stringify(blocks);
}

export function turnItemsToMessageBlocks(args: TurnItemsToMessageContentArgs): MessageContentBlock[] {
  const blocks: MessageContentBlock[] = [];
  const reasoningText = collectReasoningText(args.items, args.reasoningText);
  const finalAgentMessage = selectFinalAgentMessage(args.items);
  const finalText = finalAgentMessage?.text.trim() || args.assistantText?.trim() || "";
  let processCount = 0;

  if (reasoningText) {
    blocks.push({ type: "thinking", thinking: reasoningText });
    processCount += 1;
  }

  for (const item of args.items) {
    if (item.type === "agentMessage") {
      const text = item.text.trim();
      if (text && item.id !== finalAgentMessage?.id) {
        blocks.push({ type: "codex_process_text", text });
        processCount += 1;
      }
      continue;
    }

    if (item.type === "reasoning") {
      continue;
    }

    if (item.type === "plan") {
      const block = proposedPlanBlockFromText(item.text, "app-server.item/completed");
      if (block) {
        blocks.push(block);
      }
      continue;
    }

    if (item.type === "contextCompaction") {
      const status = args.contextCompactionStatusById?.[item.id] ?? "completed";
      blocks.push({
        type: "codex_context_compaction",
        status,
        sourceBreadcrumb:
          status === "inProgress" ? "app-server.item/started" : "app-server.item/completed",
      });
      processCount += 1;
      continue;
    }

    const context = toolContext(item, args);
    const toolUse = codexWebToolUseFromItem(item, context);
    if (!toolUse) continue;

    blocks.push({
      type: "tool_use",
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.input,
    });
    processCount += 1;

    const result = codexWebToolResultFromItem(item, context);
    if (result) {
      blocks.push({
        type: "tool_result",
        tool_use_id: result.tool_use_id,
        content: result.content,
        is_error: result.is_error,
        media: result.media,
      });
    }
  }

  if (processCount > 0) {
    blocks.push({
      type: "codex_summary",
      ...(typeof args.durationMs === "number" ? { elapsed_ms: args.durationMs } : {}),
      ...(processCount > 0 ? { process_count: processCount } : {}),
    });
  }

  for (const block of args.planBlocks ?? []) {
    if (
      block.type === "codex_proposed_plan" &&
      blocks.some((existing) => existing.type === "codex_proposed_plan")
    ) {
      continue;
    }
    blocks.push(block);
  }

  if (finalText) {
    blocks.push({ type: "text", text: finalText });
  }

  // 终态信息必须追加在已有输出之后，避免中断或错误掩盖部分回答。
  if (args.interrupted) {
    blocks.push({
      type: "codex_interrupted",
      ...(typeof args.durationMs === "number" ? { elapsed_ms: args.durationMs } : {}),
      sourceBreadcrumb: "app-server.turn/completed",
    });
  }
  if (args.errorMessage?.trim()) {
    blocks.push({
      type: "codex_error",
      message: args.errorMessage.trim(),
      sourceBreadcrumb: args.errorSourceBreadcrumb ?? "app-server.turn/completed",
    });
  }

  return blocks;
}

function collectReasoningText(items: ThreadItem[], reasoningText?: string): string {
  const parts: string[] = [];
  if (reasoningText?.trim()) {
    parts.push(reasoningText.trim());
  }

  for (const item of items) {
    if (item.type !== "reasoning") continue;
    const summary = item.summary.join("").trim();
    if (summary) {
      parts.push(summary);
    }
  }

  return uniqueJoined(parts);
}

function selectFinalAgentMessage(
  items: ThreadItem[],
): Extract<ThreadItem, { type: "agentMessage" }> | undefined {
  const messages = items.filter(
    (item): item is Extract<ThreadItem, { type: "agentMessage" }> =>
      item.type === "agentMessage" && !!item.text.trim(),
  );
  return (
    messages.findLast((item) => item.phase === "final_answer") ??
    messages.findLast((item) => item.phase !== "commentary")
  );
}

function uniqueJoined(parts: string[]): string {
  const seen = new Set<string>();
  return parts
    .filter((part) => {
      if (seen.has(part)) return false;
      seen.add(part);
      return true;
    })
    .join("\n\n");
}

function toolContext(item: ThreadItem, args: TurnItemsToMessageContentArgs): ToolItemContext {
  if (item.type === "fileChange") {
    return {
      output: args.toolOutputs?.[item.id],
      fileChanges: args.filePatchChanges?.[item.id] ?? item.changes,
    };
  }

  if (item.type === "mcpToolCall") {
    return {
      mcpProgress: args.mcpProgress?.[item.id],
    };
  }

  if (item.type === "commandExecution") {
    return {
      output: args.toolOutputs?.[item.id],
    };
  }

  return {};
}
