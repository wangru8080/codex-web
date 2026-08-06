import { describe, expect, it, vi } from "vitest";

import type { ThreadGoal } from "@/codex/protocol/generated/v2/ThreadGoal";
import type { ThreadGoalStatus } from "@/codex/protocol/generated/v2/ThreadGoalStatus";

import {
  editedGoalStatus,
  formatGoalElapsedSeconds,
  formatGoalTokensCompact,
  goalObjectiveLabel,
  goalProgressLabel,
  goalStatusLabel,
  goalSummaryLines,
  liveGoalElapsedSeconds,
  shouldInterruptForGoalPause,
  updateGoalStatusWithTurnControl,
} from "../goal-display-adapter";

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

  it("目标控制条显示裁剪后的目标内容，空目标使用兜底文案", () => {
    expect(goalObjectiveLabel(goal("active", { objective: "  完成 Phase 6U  " }))).toBe("完成 Phase 6U");
    expect(goalObjectiveLabel(goal("active", { objective: "   " }))).toBe("Untitled goal");
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

  it("只在 active goal 的运行中 turn 上实时累计耗时", () => {
    const activeGoal = goal("active", { timeUsedSeconds: 8 });
    expect(liveGoalElapsedSeconds({
      goal: activeGoal,
      observedAtMs: 2_000,
      turnStartedAtMs: 1_000,
      nowMs: 7_000,
      turnStatus: "running",
    })).toBe(13);
    expect(liveGoalElapsedSeconds({
      goal: goal("paused", { timeUsedSeconds: 8 }),
      observedAtMs: 2_000,
      turnStartedAtMs: 1_000,
      nowMs: 7_000,
      turnStatus: "running",
    })).toBe(8);
    expect(liveGoalElapsedSeconds({
      goal: activeGoal,
      observedAtMs: 2_000,
      turnStartedAtMs: 1_000,
      nowMs: 7_000,
      turnStatus: "completed",
    })).toBe(8);
  });

  it("运行中暂停目标需要中断 turn，空闲暂停和恢复不需要", () => {
    expect(shouldInterruptForGoalPause("paused", "running")).toBe(true);
    expect(shouldInterruptForGoalPause("paused", "starting")).toBe(true);
    expect(shouldInterruptForGoalPause("paused", "completed")).toBe(false);
    expect(shouldInterruptForGoalPause("active", "running")).toBe(false);
  });

  it("目标状态更新失败时不调用 interrupt", async () => {
    const updateGoal = vi.fn().mockRejectedValue(new Error("goal update failed"));
    const interruptTurn = vi.fn();

    await expect(updateGoalStatusWithTurnControl({
      status: "paused",
      turnStatus: "running",
      updateGoal,
      interruptTurn,
    })).rejects.toThrow("goal update failed");
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("目标暂停成功但 interrupt 失败时保留明确的调用顺序并向上抛错", async () => {
    const calls: string[] = [];
    const updateGoal = vi.fn(async (status: ThreadGoalStatus) => {
      calls.push(`goal:${status}`);
    });
    const interruptTurn = vi.fn(async () => {
      calls.push("interrupt");
      throw new Error("interrupt failed");
    });

    await expect(updateGoalStatusWithTurnControl({
      status: "paused",
      turnStatus: "running",
      updateGoal,
      interruptTurn,
    })).rejects.toThrow("interrupt failed");
    expect(calls).toEqual(["goal:paused", "interrupt"]);
  });

  it("非运行中 turn 和恢复目标只更新 goal", async () => {
    const updateGoal = vi.fn(async () => undefined);
    const interruptTurn = vi.fn(async () => undefined);

    await updateGoalStatusWithTurnControl({
      status: "paused",
      turnStatus: "completed",
      updateGoal,
      interruptTurn,
    });
    await updateGoalStatusWithTurnControl({
      status: "active",
      turnStatus: "running",
      updateGoal,
      interruptTurn,
    });

    expect(updateGoal).toHaveBeenNthCalledWith(1, "paused");
    expect(updateGoal).toHaveBeenNthCalledWith(2, "active");
    expect(interruptTurn).not.toHaveBeenCalled();
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
