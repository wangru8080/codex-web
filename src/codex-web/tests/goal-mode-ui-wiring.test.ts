import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("目标模式 UI 接线", () => {
  it("两条聊天入口都使用目标编辑模态框且不再调用 window.prompt", () => {
    const newChatPage = read("src/app/chat/page.tsx");
    const chatView = read("src/components/chat/ChatView.tsx");

    expect(newChatPage).toContain("<GoalEditDialog");
    expect(chatView).toContain("<GoalEditDialog");
    expect(newChatPage).not.toContain("window.prompt('Edit goal'");
    expect(chatView).not.toContain("window.prompt('Edit goal'");
  });

  it("运行中暂停目标通过共享判定组合 goal set 与 turn interrupt", () => {
    const newChatPage = read("src/app/chat/page.tsx");
    const chatView = read("src/components/chat/ChatView.tsx");

    expect(newChatPage).toContain("updateGoalStatusWithTurnControl({");
    expect(newChatPage).toContain("() => interruptTurn({ threadId: appServerTurn.threadId");
    expect(chatView).toContain("updateGoalStatusWithTurnControl({");
    expect(chatView).toContain("interruptTurn: appServerInterrupt");
  });

  it("两条聊天入口都收口目标更新与清除失败并解除 pending", () => {
    const newChatPage = read("src/app/chat/page.tsx");
    const chatView = read("src/components/chat/ChatView.tsx");

    for (const source of [newChatPage, chatView]) {
      expect(source).toContain("目标更新失败");
      expect(source).toContain("目标清除失败");
      expect(source).toContain("setGoalMutationPending(false)");
    }
  });

  it("只有显式目标消息 id 才显示目标标志", () => {
    const messageList = read("src/components/chat/MessageList.tsx");
    const messageItem = read("src/components/chat/MessageItem.tsx");

    expect(messageList).toContain("isGoalMessage={goalMessageIds?.has(row.message.id)}");
    expect(messageItem).toContain("isUser && isGoalMessage");
    expect(messageItem).toContain("data-goal-message-marker");
    expect(messageItem).toContain("设为目标");
  });

  it("目标条保留 app-server source breadcrumb 但不把它显示为主文案", () => {
    const row = read("src/components/chat/GoalProgressRow.tsx");

    expect(row).toContain("data-goal-source={sourceBreadcrumb}");
    expect(row).not.toContain(">{sourceBreadcrumb}</");
    expect(row).toContain("turnStatus !== 'running'");
    expect(row).toContain("w-[calc(100%-2rem)] max-w-[45rem]");
  });

  it("目标标志位于用户消息气泡之外", () => {
    const messageItem = read("src/components/chat/MessageItem.tsx");
    const messageContentEnd = messageItem.indexOf("</MessageContent>");
    const marker = messageItem.indexOf("data-goal-message-marker");

    expect(messageContentEnd).toBeGreaterThan(-1);
    expect(marker).toBeGreaterThan(messageContentEnd);
    expect(messageItem).toContain("self-end");
  });
});
