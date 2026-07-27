import { describe, expect, it } from "vitest";

import {
  buildHistoryPaginationRegressionPlan,
} from "../history-pagination-regression-plan";
import { defaultTestCodexHome } from "../test-codex-home";

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
    expect(commands).toContain(`CODEX_HOME=${defaultTestCodexHome}`);
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

  it("生成命令时接受自定义或真实 CODEX_HOME", () => {
    const custom = buildHistoryPaginationRegressionPlan({ codexHome: "/tmp/codex-smoke-b" });
    const real = buildHistoryPaginationRegressionPlan({ codexHome: "/home/user/.codex" });

    expect(custom.map((step) => step.command ?? "").join("\n")).toContain("CODEX_HOME=/tmp/codex-smoke-b");
    expect(real.map((step) => step.command ?? "").join("\n")).toContain("CODEX_HOME=/home/user/.codex");
  });
});
