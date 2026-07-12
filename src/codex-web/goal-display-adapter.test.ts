import { describe, expect, it } from "vitest";

import type { ThreadGoal } from "@/codex/protocol/generated/v2/ThreadGoal";
import type { ThreadGoalStatus } from "@/codex/protocol/generated/v2/ThreadGoalStatus";

import {
  editedGoalStatus,
  formatGoalElapsedSeconds,
  formatGoalTokensCompact,
  goalProgressLabel,
  goalStatusLabel,
  goalSummaryLines,
} from "./goal-display-adapter";

describe("goal-display-adapter", () => {
  it("按官方 TUI 规则格式化 elapsed seconds", () => {
    expect(formatGoalElapsedSeconds(0)).toBe("0s");
    expect(formatGoalElapsedSeconds(59)).toBe("59s");
    expect(formatGoalElapsedSeconds(60)).toBe("1m");
    expect(formatGoalElapsedSeconds(90 * 60)).toBe("1h 30m");
    expect(formatGoalElapsedSeconds(2 * 24 * 60 * 60 + 23 * 60 * 60 + 42 * 60)).toBe("2d 23h 42m");
  });

  it("按官方 TUI 规则格式化 compact tokens", () => {
    expect(formatGoalTokensCompact(0)).toBe("0");
    expect(formatGoalTokensCompact(999)).toBe("999");
    expect(formatGoalTokensCompact(12_500)).toBe("12.5K");
    expect(formatGoalTokensCompact(40_000)).toBe("40K");
    expect(formatGoalTokensCompact(1_234_567)).toBe("1.23M");
  });

  it("active goal 有 token budget 时显示 token usage，无 budget 时显示 elapsed", () => {
    expect(goalProgressLabel(goal("active", { tokensUsed: 40_000, tokenBudget: 50_000 }))).toBe(
      "Pursuing goal (40K / 50K)",
    );
    expect(goalProgressLabel(goal("active", { tokenBudget: null, timeUsedSeconds: 120 }))).toBe(
      "Pursuing goal (2m)",
    );
  });

  it("覆盖 paused/blocked/usageLimited/budgetLimited/complete 官方文案", () => {
    expect(goalProgressLabel(goal("paused"))).toBe("Goal paused (/goal resume)");
    expect(goalProgressLabel(goal("blocked"))).toBe("Goal blocked (/goal resume)");
    expect(goalProgressLabel(goal("usageLimited"))).toBe("Goal hit usage limits (/goal resume)");
    expect(goalProgressLabel(goal("budgetLimited", { tokensUsed: 63_876, tokenBudget: 50_000 }))).toBe(
      "Goal unmet (63.9K / 50K tokens)",
    );
    expect(goalProgressLabel(goal("budgetLimited", { tokenBudget: null }))).toBe("Goal abandoned");
    expect(goalProgressLabel(goal("complete", { tokenBudget: null, timeUsedSeconds: 36_720 }))).toBe(
      "Goal achieved (10h 12m)",
    );
    expect(goalProgressLabel(goal("complete", { tokenBudget: 50_000, tokensUsed: 40_000 }))).toBe(
      "Goal achieved (40K tokens)",
    );
  });

  it("生成 /goal summary lines 和状态标签", () => {
    const lines = goalSummaryLines(goal("paused", { tokenBudget: 50_000, tokensUsed: 12_500 }));

    expect(goalStatusLabel("budgetLimited")).toBe("limited by budget");
    expect(lines).toEqual([
      "Goal",
      "Status: paused",
      "Objective: 完成 Phase 6U",
      "Time used: 2m",
      "Tokens used: 12.5K",
      "Token budget: 50K",
      "",
      "Commands: /goal edit, /goal resume, /goal clear",
    ]);
  });

  it("edit budgetLimited/complete goal 时按官方规则恢复 active", () => {
    expect(editedGoalStatus("active")).toBe("active");
    expect(editedGoalStatus("paused")).toBe("paused");
    expect(editedGoalStatus("budgetLimited")).toBe("active");
    expect(editedGoalStatus("complete")).toBe("active");
  });
});

function goal(status: ThreadGoalStatus, overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    threadId: "thread-1",
    objective: "完成 Phase 6U",
    status,
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 120,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
