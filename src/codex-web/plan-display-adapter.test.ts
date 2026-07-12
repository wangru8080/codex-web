import { describe, expect, it } from "vitest";

import {
  planProgressFromSteps,
  proposedPlanBlockFromText,
  updatedPlanBlockFromNotification,
} from "./plan-display-adapter";

describe("plan-display-adapter", () => {
  it("空 proposed plan 不产生块", () => {
    expect(proposedPlanBlockFromText("   \n", "app-server.item/completed")).toBeNull();
  });

  it("非空 ThreadItem::Plan.text 生成 Proposed Plan 块", () => {
    expect(proposedPlanBlockFromText("  1. 写测试\n2. 实现  ", "app-server.item/completed")).toEqual({
      type: "codex_proposed_plan",
      text: "1. 写测试\n2. 实现",
      sourceBreadcrumb: "app-server.item/completed",
    });
  });

  it("turn/plan/updated 生成 Updated Plan checklist", () => {
    const block = updatedPlanBlockFromNotification(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        explanation: "按官方语义拆分。",
        plan: [
          { step: "写 adapter", status: "completed" },
          { step: "接 UI", status: "inProgress" },
          { step: "跑 smoke", status: "pending" },
        ],
      },
      "app-server.turn/plan/updated",
    );

    expect(block).toEqual({
      type: "codex_updated_plan",
      explanation: "按官方语义拆分。",
      steps: [
        { step: "写 adapter", status: "completed" },
        { step: "接 UI", status: "inProgress" },
        { step: "跑 smoke", status: "pending" },
      ],
      sourceBreadcrumb: "app-server.turn/plan/updated",
      progress: { completed: 1, total: 3 },
    });
  });

  it("空 steps 显示空态所需数据，但不产生 0/0 进度", () => {
    const block = updatedPlanBlockFromNotification(
      { threadId: "thread-1", turnId: "turn-1", explanation: null, plan: [] },
      "app-server.turn/plan/updated",
    );

    expect(block).toEqual({
      type: "codex_updated_plan",
      explanation: null,
      steps: [],
      sourceBreadcrumb: "app-server.turn/plan/updated",
      progress: null,
    });
    expect(planProgressFromSteps([])).toBeNull();
  });
});
