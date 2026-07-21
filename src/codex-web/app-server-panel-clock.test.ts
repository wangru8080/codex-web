import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolveAppServerPanelStartedAt } from "./app-server-panel-clock";
import { createAcceptedTurnState } from "./turn-reducer";

describe("resolveAppServerPanelStartedAt", () => {
  it("切回运行任务时使用 Turn 真实起点，不采用新挂载的本地时间", () => {
    const turn = createAcceptedTurnState("thread-a", "turn-a", 10_000);

    expect(resolveAppServerPanelStartedAt(turn, 55_000, 60_000)).toBe(10_000);
  });

  it("新任务未拿到 app-server 开始时间时使用本地 pending clock", () => {
    const turn = createAcceptedTurnState("thread-b", "turn-b");

    expect(resolveAppServerPanelStartedAt(turn, 55_000, 60_000)).toBe(55_000);
  });

  it("终态缺少开始时间时按 durationMs 推导，不影响旧协议兼容", () => {
    const turn = {
      ...createAcceptedTurnState("thread-a", "turn-a"),
      status: "completed" as const,
      durationMs: 12_000,
    };

    expect(resolveAppServerPanelStartedAt(turn, 55_000, 60_000)).toBe(48_000);
  });

  it("ChatView 把活动 Turn 和本地 pending clock 交给统一选择器", () => {
    const chatView = readFileSync(
      new URL("../components/chat/ChatView.tsx", import.meta.url),
      "utf8",
    );

    expect(chatView).toContain(
      "resolveAppServerPanelStartedAt(appServerTurn ?? null, appServerPanelClock.startedAt)",
    );
  });
});
