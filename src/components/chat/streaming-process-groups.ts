import type { MessageContentBlock } from "@/types";

export type StreamingProcessBlock = Extract<
  MessageContentBlock,
  {
    type:
      | "thinking"
      | "codex_process_text"
      | "codex_context_compaction"
      | "tool_use";
  }
>;

type ToolUseBlock = Extract<StreamingProcessBlock, { type: "tool_use" }>;

export type StreamingProcessSegment =
  | { type: "tools"; blocks: ToolUseBlock[] }
  | { type: "block"; block: Exclude<StreamingProcessBlock, ToolUseBlock> };

export function groupConsecutiveToolBlocks(
  blocks: readonly StreamingProcessBlock[],
): StreamingProcessSegment[] {
  const segments: StreamingProcessSegment[] = [];
  let pendingTools: ToolUseBlock[] = [];

  const flushTools = () => {
    if (pendingTools.length === 0) return;
    segments.push({ type: "tools", blocks: pendingTools });
    pendingTools = [];
  };

  for (const block of blocks) {
    if (block.type === "tool_use") {
      pendingTools.push(block);
      continue;
    }

    flushTools();
    segments.push({ type: "block", block });
  }

  flushTools();
  return segments;
}
