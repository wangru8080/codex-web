import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../components/chat/ChatView.tsx", import.meta.url), "utf8");
const newChatSource = readFileSync(new URL("../../app/chat/page.tsx", import.meta.url), "utf8");
const appServerBranch = source.slice(
  source.indexOf("if (appServerSend) {", source.indexOf("const sendMessage = useCallback")),
  source.indexOf("// Hoist provider-state guards", source.indexOf("const sendMessage = useCallback")),
);
const firstMessageBranch = newChatSource.slice(
  newChatSource.indexOf("const sendFirstMessage = useCallback"),
  newChatSource.indexOf("const appServerGoal =", newChatSource.indexOf("const sendFirstMessage = useCallback")),
);

describe("app-server 用户消息弱网时序", () => {
  it("等待 turn/start 前先展示用户消息", () => {
    const appendIndex = appServerBranch.indexOf("cappedSetMessages((prev) => [...prev, optimisticUserMessage])");
    const requestIndex = appServerBranch.indexOf("await appServerSend({");

    expect(appendIndex).toBeGreaterThan(-1);
    expect(requestIndex).toBeGreaterThan(-1);
    expect(appendIndex).toBeLessThan(requestIndex);
  });

  it("接受后原位补充 turn 信息，未接受即失败时精确撤回", () => {
    expect(appServerBranch).toContain("message.id === optimisticUserMessage.id");
    expect(appServerBranch).toContain("id: `temp-user-${turnId}`");
    expect(appServerBranch).toContain("turn_id: turnId");
    expect(appServerBranch).toContain("prev.filter((message) => message.id !== optimisticUserMessage.id)");
    expect(appServerBranch).toContain("onAppServerUserMessageAccepted?.({");
  });

  it("新对话也在等待 turn/start 前展示问题，并保留草稿到接受", () => {
    const appendIndex = firstMessageBranch.indexOf("setMessages((prev) => [...prev, optimisticUserMessage])");
    const requestIndex = firstMessageBranch.indexOf("await sendOneTurn({");

    expect(appendIndex).toBeGreaterThan(-1);
    expect(requestIndex).toBeGreaterThan(-1);
    expect(appendIndex).toBeLessThan(requestIndex);
    expect(firstMessageBranch).toContain("sessionStorage.setItem(composerDraftKey(), content)");
    expect(firstMessageBranch).toContain("sessionStorage.setItem(PENDING_NEW_CHAT_DRAFT_KEY, '1')");
    expect(firstMessageBranch).toContain("sessionStorage.removeItem(PENDING_NEW_CHAT_DRAFT_KEY)");
  });

  it("新对话接受后原位补充 turn 信息，未接受失败时撤回本次问题", () => {
    expect(firstMessageBranch).toContain("message.id === optimisticUserMessage.id");
    expect(firstMessageBranch).toContain("id: `temp-user-${turnId}`");
    expect(firstMessageBranch).toContain("turn_id: turnId");
    expect(firstMessageBranch).toContain("prev.filter((message) => message.id !== optimisticUserMessage.id)");
  });

  it("新对话首屏与活动态复用同一个 composer 挂载点", () => {
    const returnBranch = newChatSource.slice(newChatSource.indexOf("return (", newChatSource.indexOf("const composerStack")));
    expect(returnBranch).toContain('data-testid="new-chat-composer-slot"');
    expect(returnBranch.match(/\{composerStack\}/g)).toHaveLength(1);
  });

  it("强刷只恢复一次待接受草稿，不自动重发", () => {
    expect(newChatSource).toContain("const preservePendingDraft = sessionStorage.getItem(PENDING_NEW_CHAT_DRAFT_KEY) === '1'");
    expect(newChatSource).toContain("if (!preservePendingDraft) sessionStorage.removeItem(composerDraftKey())");
    expect(newChatSource).not.toContain("sessionStorage.getItem(PENDING_NEW_CHAT_DRAFT_KEY) === '1' && sendFirstMessage");
  });
});
