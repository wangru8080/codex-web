import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("app-server 上下文窗口圆环接线", () => {
  const provider = readFileSync(resolve(process.cwd(), "src/codex-web/AppServerProvider.tsx"), "utf8");
  const state = readFileSync(resolve(process.cwd(), "src/codex-web/app-server-state.ts"), "utf8");
  const input = readFileSync(resolve(process.cwd(), "src/components/chat/MessageInput.tsx"), "utf8");
  const chatView = readFileSync(resolve(process.cwd(), "src/components/chat/ChatView.tsx"), "utf8");
  const newChat = readFileSync(resolve(process.cwd(), "src/app/chat/page.tsx"), "utf8");
  const history = readFileSync(resolve(process.cwd(), "src/app/chat/[id]/page.tsx"), "utf8");

  it("Provider 保存 thread/tokenUsage/updated", () => {
    expect(state).toContain("threadTokenUsageByThreadId");
    expect(state).toContain("app-server.thread/tokenUsage/updated");
    expect(provider).toContain("reduceThreadTokenUsageNotification");
  });

  it("圆环位于模型选择器左侧", () => {
    expect(input).toContain("<ContextWindowIndicator");
    expect(input.indexOf("<ContextWindowIndicator")).toBeLessThan(
      input.indexOf("<ComposerReasoningModelSelector"),
    );
  });

  it("新对话和历史会话不再渲染外部 RunCockpit", () => {
    expect(chatView).not.toContain("<RunCockpit");
    expect(newChat).not.toContain("<RunCockpit");
  });

  it("新对话和历史会话都传递当前线程权威用量", () => {
    expect(newChat).toContain("threadTokenUsageByThreadId");
    expect(newChat).toContain("contextWindowUsage=");
    expect(history).toContain("threadTokenUsageByThreadId");
    expect(history).toContain("appServerTokenUsage=");
    expect(chatView).toContain("contextWindowUsage={appServerTokenUsage}");
  });
});
