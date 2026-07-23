import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const provider = readFileSync(new URL("./AppServerProvider.tsx", import.meta.url), "utf8");
const newChatPage = readFileSync(new URL("../app/chat/page.tsx", import.meta.url), "utf8");
const historyPage = readFileSync(new URL("../app/chat/[id]/page.tsx", import.meta.url), "utf8");

describe("app-server 断线重连接线", () => {
  it("连接关闭后保留运行 Turn 并进入自动重连", () => {
    expect(provider).toContain('connection: { source: "web-bridge", data: "reconnecting" }');
    expect(provider).toContain("scheduleReconnect()");
    expect(provider).toContain("reconnectDelayMs(reconnectAttempt)");
    expect(provider).not.toContain("failRunningTurnOnTransportClose(current.activeTurn");
  });

  it("每次 bootstrap 先解析最新 bridge URL，再复用同一个 client 连接", () => {
    expect(provider.match(/new AppServerBrowserClient/g)).toHaveLength(1);
    expect(provider).toContain("const latestBridgeUrl = await resolveCodexBridgeUrl(publicBridgeUrl)");
    expect(provider).toContain("await client.connect(latestBridgeUrl)");
    expect(provider.indexOf("const latestBridgeUrl = await resolveCodexBridgeUrl(publicBridgeUrl)"))
      .toBeLessThan(provider.indexOf("await client.connect(latestBridgeUrl)"));
  });

  it("重连 bootstrap 完成后历史页重新执行 thread/resume", () => {
    expect(provider).toContain('client.request("initialize"');
    expect(provider).toContain('client.request(\n      "thread/resume"');
    expect(historyPage).toContain("const resume = await resumeThread({ threadId: id })");
    expect(historyPage).toContain("useAppServerSelector((state) => state.connection.data)");
    expect(historyPage).toContain("connectionData !== 'connected'");
  });

  it("新任务被接受后进入 Thread 路由，使刷新能够恢复运行态", () => {
    expect(newChatPage).toContain("if (!existingThreadId)");
    expect(newChatPage).toContain("router.push(`/chat/${encodeURIComponent(acceptedTurn.threadId)}`)");
  });

  it("thread/resume 使用真实 active Turn 水合并清理陈旧运行态", () => {
    expect(provider).toContain("const resumedActiveTurn = activeTurnFromResume(response)");
    expect(provider).toContain('sourcedActiveTurn(resumedActiveTurn, "app-server.thread/resume")');
    expect(provider).toContain("removeActiveTurnByThread(current.activeTurnsByThreadId, response.thread.id)");
  });
});
