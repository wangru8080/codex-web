import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const provider = readFileSync(new URL("../AppServerProvider.tsx", import.meta.url), "utf8");
const state = readFileSync(new URL("../app-server-state.ts", import.meta.url), "utf8");
const topBar = readFileSync(new URL("../../components/layout/UnifiedTopBar.tsx", import.meta.url), "utf8");
const popover = readFileSync(new URL("../../components/layout/OnlineUsersPopover.tsx", import.meta.url), "utf8");
const en = readFileSync(new URL("../../i18n/en.ts", import.meta.url), "utf8");
const zh = readFileSync(new URL("../../i18n/zh.ts", import.meta.url), "utf8");

describe("root 在线人数前端接线", () => {
  it("presence 通知写入带来源的状态，断线时清空", () => {
    expect(state).toContain('onlineUsers: Sourced<number> | null');
    expect(state).toContain('"runtime-broker.presence"');
    expect(provider).toContain("readBrokerPresence(notification)");
    expect(provider).toContain('onlineUsers: { source: "runtime-broker.presence", data: onlineUsers }');
    expect(provider).toContain("onlineUsers: null");
  });

  it("顶部栏仅在收到人数后显示标识", () => {
    expect(topBar).toContain("state.onlineUsers?.data ?? null");
    expect(topBar).toContain("onlineUsers !== null");
    expect(topBar).toContain("<OnlineUsersPopover onlineUsers={onlineUsers} />");
    expect(popover).toContain("data-online-user-count={onlineUsers}");
    expect(popover).toContain("<Users size={14}");
  });

  it("点击后按 cursor 请求并虚拟渲染在线账号", () => {
    expect(provider).toContain("listOnlineUsers: (params: BrokerPresenceListParams)");
    expect(provider).toContain("client.request(BROKER_PRESENCE_LIST_METHOD, params)");
    expect(popover).toContain("listOnlineUsers");
    expect(popover).toContain("<Virtuoso");
    expect(popover).toContain("endReached={loadNextPage}");
    expect(popover).toContain("data-online-user-list");
    expect(popover).toContain("setTimeout");
  });

  it("中英文提示均包含在线人数", () => {
    expect(en).toContain("'topBar.onlineUsers': '{count} online'");
    expect(zh).toContain("'topBar.onlineUsers': '{count} 人在线'");
    expect(zh).toContain("'topBar.onlineUsersSearch': '搜索邮箱、账号 ID 或 Linux 用户'");
  });
});
