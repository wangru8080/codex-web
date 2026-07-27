import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("附件 E2E 最终回答作用域", () => {
  const message = readFileSync(resolve(process.cwd(), "src/components/ai-elements/message.tsx"), "utf8");
  const item = readFileSync(resolve(process.cwd(), "src/components/chat/MessageItem.tsx"), "utf8");
  const streaming = readFileSync(resolve(process.cwd(), "src/components/chat/StreamingMessage.tsx"), "utf8");
  const script = readFileSync(resolve(process.cwd(), "scripts/attachment-restart-cdp-e2e.ts"), "utf8");

  it("消息和最终回答提供稳定的角色语义", () => {
    expect(message).toContain("data-message-role={from}");
    expect(item).toContain("data-assistant-final-answer");
    expect(streaming).toContain("data-assistant-final-answer");
  });

  it("脚本只等待本次 marker 之后的助手最终回答", () => {
    expect(script).toContain("waitForCurrentTurnAssistantAnswer");
    expect(script).toContain('[data-message-role="user"]');
    expect(script).toContain("[data-assistant-final-answer]");
    expect(script).toContain("Node.DOCUMENT_POSITION_FOLLOWING");
    expect(script).toContain("const nextUser = users[userIndex + 1]");
    expect(script).not.toContain("document.body.innerText.includes(${JSON.stringify(expectedAnswer)})");
  });
});
