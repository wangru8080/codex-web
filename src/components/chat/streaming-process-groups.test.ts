import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { MessageContentBlock } from "@/types";

import { groupConsecutiveToolBlocks } from "./streaming-process-groups";

const thinking = { type: "thinking", thinking: "检查上下文" } satisfies MessageContentBlock;
const firstTool = {
  type: "tool_use",
  id: "tool-1",
  name: "exec_command",
  input: { cmd: "pwd" },
} satisfies MessageContentBlock;
const secondTool = {
  type: "tool_use",
  id: "tool-2",
  name: "exec_command",
  input: { cmd: "git status --short" },
} satisfies MessageContentBlock;
const processText = {
  type: "codex_process_text",
  text: "继续检查测试配置。",
} satisfies MessageContentBlock;
const thirdTool = {
  type: "tool_use",
  id: "tool-3",
  name: "read_file",
  input: { path: "package.json" },
} satisfies MessageContentBlock;

describe("groupConsecutiveToolBlocks", () => {
  it("把相邻工具合并为一组，并由过程正文切断分组", () => {
    expect(
      groupConsecutiveToolBlocks([
        thinking,
        firstTool,
        secondTool,
        processText,
        thirdTool,
      ]),
    ).toEqual([
      { type: "block", block: thinking },
      { type: "tools", blocks: [firstTool, secondTool] },
      { type: "block", block: processText },
      { type: "tools", blocks: [thirdTool] },
    ]);
  });

  it("普通块保持原始顺序且不会生成空工具组", () => {
    const compaction = {
      type: "codex_context_compaction",
      status: "completed",
      sourceBreadcrumb: "app-server.item/completed",
    } satisfies MessageContentBlock;

    expect(groupConsecutiveToolBlocks([thinking, processText, compaction])).toEqual([
      { type: "block", block: thinking },
      { type: "block", block: processText },
      { type: "block", block: compaction },
    ]);
  });

  it("单个工具仍形成可独立折叠的工具组", () => {
    expect(groupConsecutiveToolBlocks([firstTool])).toEqual([
      { type: "tools", blocks: [firstTool] },
    ]);
  });

  it("空输入不产生任何分组", () => {
    expect(groupConsecutiveToolBlocks([])).toEqual([]);
  });
});

describe("连续工具分组展示接线", () => {
  it("流式消息在整轮过程内分组工具，并在 final 开始后折叠整轮过程", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/chat/StreamingMessage.tsx"),
      "utf8",
    );

    expect(source).toContain("<ProcessCollapseGroup");
    expect(source).toContain("defaultExpanded={!finalStarted}");
    expect(source).toContain("active={!finalStarted && isStreaming}");
    expect(source).toContain("<span>已处理</span>");
    expect(source).not.toContain("finalStarted ? '已处理' : '正在处理'");
    expect(source).not.toContain("displayText === '已处理'");
    expect(source).toContain("isStreaming && !hasProcessActivity && statusText !== '已处理' && <StreamingStatusBar");
    expect(source).toContain("groupConsecutiveToolBlocks(orderedProcessBlocks)");
    expect(source).toContain("tools={tools}");
    expect(source).toContain("hasRunningTool ? 'running' : 'complete'");
    expect(source).toContain("defaultExpanded={hasRunningTool}");
  });

  it("app-server 最终回答直接使用增量内容，不经过延迟缓冲", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/chat/StreamingMessage.tsx"),
      "utf8",
    );

    expect(source).not.toContain("BUFFER_WORD_THRESHOLD");
    expect(source).not.toContain("BUFFER_MAX_MS");
    expect(source).not.toContain("useBufferedContent");
    expect(source).toContain("<MessageResponse>{content}</MessageResponse>");
    expect(source).toContain("StreamingMessageResponse as MessageResponse");
  });

  it("app-server 可重试错误在流式消息中展示真实标题和可展开详情", () => {
    const streamingSource = readFileSync(
      resolve(process.cwd(), "src/components/chat/StreamingMessage.tsx"),
      "utf8",
    );
    const pageSource = readFileSync(
      resolve(process.cwd(), "src/app/chat/page.tsx"),
      "utf8",
    );

    expect(streamingSource).toContain("data-app-server-retry-status");
    expect(streamingSource).toContain("status.additionalDetails");
    expect(streamingSource).toContain("/^Reconnecting\\.\\.\\. (\\d+)\\/(\\d+)$/");
    expect(streamingSource).toContain("t('streaming.reconnecting', { current: reconnectMatch[1], total: reconnectMatch[2] })");
    expect(streamingSource).toContain(": status.message");
    expect(streamingSource).toContain("aria-expanded={expanded}");
    expect(streamingSource).toContain("<WifiHigh");
    expect(pageSource).toContain("retryStatus={appServerTurn?.retryStatus}");

    const chatViewSource = readFileSync(
      resolve(process.cwd(), "src/components/chat/ChatView.tsx"),
      "utf8",
    );
    expect(chatViewSource).toContain("retryStatus={appServerTurn?.retryStatus}");
  });

  it("历史消息默认折叠整轮过程，并保留连续工具子分组", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/chat/MessageItem.tsx"),
      "utf8",
    );

    expect(source).toContain("<ProcessCollapseGroup");
    expect(source).toContain("elapsedMs={elapsedMs}");
    expect(source).toContain("processCount={processCount}");
    expect(source).toContain("processParts.map((part, index) => renderAssistantPart(part, index))");
    expect(source).toContain("tools={segmentTools.map");
    expect(source).toContain("defaultExpanded={false}");
  });

  it("app-server 实时过程使用稳定起始时间和已处理文案", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/chat/ChatView.tsx"),
      "utf8",
    );

    expect(source).toContain("const [appServerPanelClock, setAppServerPanelClock]");
    expect(source).toContain("? '已处理'");
    expect(source).toContain("setAppServerPanelClock({ turnKey: 'pending', startedAt: Date.now() })");
    expect(source).toContain(
      "resolveAppServerPanelStartedAt(appServerTurn ?? null, appServerPanelClock.startedAt)",
    );
    expect(source).not.toContain("appServerTurn.threadId !== activeSessionId) return");
  });

  it("新会话实时过程传递开始时间并使用已处理文案", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/chat/page.tsx"),
      "utf8",
    );

    expect(source).toContain("const streamingStartedAtRef = useRef(0)");
    expect(source).toContain("streamingStartedAtRef.current = Date.now()");
    expect(source).toContain("setStatusText('已处理')");
    expect(source).toContain("startedAt={streamingStartedAtRef.current}");
    expect(source).not.toContain("setStatusText('Codex 正在处理...')");
  });
});
