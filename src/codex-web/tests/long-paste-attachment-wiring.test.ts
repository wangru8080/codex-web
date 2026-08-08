import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("长文本粘贴附件接线", () => {
  it("仅为 Codex composer 开启长文本附件化", () => {
    const promptInput = source("../../components/ai-elements/prompt-input.tsx");
    const messageInput = source("../../components/chat/MessageInput.tsx");

    expect(promptInput).toContain('new File([pastedText], "pasted-text.txt", { type: "text/plain" })');
    expect(promptInput).toContain("shouldAttachPastedText(pastedText)");
    expect(messageInput).toContain("pasteLongTextAsFile={codexOnly}");
  });

  it("乐观消息使用 app-server 已持久化的附件路径", () => {
    const provider = source("../AppServerProvider.tsx");
    const chatView = source("../../components/chat/ChatView.tsx");
    const newChatPage = source("../../app/chat/page.tsx");

    expect(provider).toContain("onAccepted?.(threadId, turnResponse.turn.id, persistedFiles)");
    expect(chatView).toContain("acceptedFiles ?? files");
    expect(chatView).toContain("if (!trimmed && !files?.length) return false");
    expect(newChatPage).toContain("userMessageContent(acceptedFiles ?? files)");
    expect(newChatPage).toContain("filePath: file.filePath");
  });

  it("带路径的普通附件点击后打开右侧只读预览", () => {
    const display = source("../../components/chat/FileAttachmentDisplay.tsx");

    expect(display).toContain("setPreviewSource({");
    expect(display).toContain('trust: "user-selected"');
    expect(display).toContain("readonly: true");
    expect(display).toContain("file.filePath");
  });
});
