import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../app/chat/[id]/page.tsx", import.meta.url), "utf8");
const chatView = readFileSync(new URL("../components/chat/ChatView.tsx", import.meta.url), "utf8");

describe("app-server 最近问题编辑接线", () => {
  it("历史页把固定一轮 rollback 接到 ChatView", () => {
    expect(page).toContain("rollbackThread({ threadId, numTurns: 1 })");
    expect(page).toContain("appServerRollbackLastTurn=");
  });

  it("ChatView 等待 rollback 成功后替换消息，再复用现有 sendMessage", () => {
    const rollbackIndex = chatView.indexOf("await appServerRollbackLastTurn()");
    const replaceIndex = chatView.indexOf("cappedSetMessages(rolledBackMessages)", rollbackIndex);
    const sendIndex = chatView.indexOf("sendMessage(content, files)", replaceIndex);

    expect(rollbackIndex).toBeGreaterThan(-1);
    expect(replaceIndex).toBeGreaterThan(rollbackIndex);
    expect(sendIndex).toBeGreaterThan(replaceIndex);
  });

  it("MessageList 只接收计算出的一个可编辑消息 id", () => {
    expect(chatView).toContain("editableUserMessageId={editableUserMessageId}");
    expect(chatView).toContain("onEditUserMessage={handleEditUserMessage}");
  });
});
