import { describe, expect, it } from "vitest";

import {
  assertHistoryPaginationRegressionEnv,
  buildHistoryPaginationRegressionPlan,
  historyPaginationRegressionCodexHome,
} from "./history-pagination-regression-plan";

describe("history-pagination-regression-plan", () => {
  it("生成长历史分页和失败注入回归清单", () => {
    const steps = buildHistoryPaginationRegressionPlan({
      threadId: "thread-123",
      markerPrefix: "phase6t",
    });
    const commands = steps.map((step) => step.command ?? "").join("\n");
    const expected = steps.map((step) => step.expected).join("\n");

    expect(steps.map((step) => step.title)).toEqual([
      "创建隔离长历史 fixture",
      "复查真实 app-server 分页",
      "启动 Load Earlier 失败注入 dev server",
      "真实浏览器验证初始分页",
      "真实浏览器验证 Load Earlier 失败",
      "标准提交前验证",
    ]);
    expect(commands).toContain(`CODEX_HOME=${historyPaginationRegressionCodexHome}`);
    expect(commands).toContain("scripts/create-long-history-fixture.ts 35 phase6t");
    expect(commands).toContain("scripts/inspect-thread-pagination.ts thread-123 30");
    expect(commands).toContain("CODEX_WEB_FAIL_THREAD_TURNS_LIST_ON_CALL=2 npm run dev");
    expect(expected).toContain("phase6t-answer-01");
    expect(expected).toContain("seenTurns=35");
    expect(expected).toContain("uniqueTurns=35");
  });

  it("没有 thread id 时保留占位提示而不猜测真实 session", () => {
    const steps = buildHistoryPaginationRegressionPlan();

    expect(steps.map((step) => step.command ?? "").join("\n")).toContain("<thread-id-from-fixture-output>");
  });

  it("拒绝非隔离 CODEX_HOME", () => {
    expect(() => assertHistoryPaginationRegressionEnv({})).toThrow(
      `历史分页回归必须使用隔离 CODEX_HOME：${historyPaginationRegressionCodexHome}`,
    );
    expect(() =>
      assertHistoryPaginationRegressionEnv({ CODEX_HOME: "/home/user/.codex" }),
    ).toThrow(historyPaginationRegressionCodexHome);
  });

  it("接受隔离 CODEX_HOME", () => {
    expect(() =>
      assertHistoryPaginationRegressionEnv({ CODEX_HOME: historyPaginationRegressionCodexHome }),
    ).not.toThrow();
  });
});
