import type { ThreadGoal } from "@/codex/protocol/generated/v2/ThreadGoal";
import type { ThreadGoalStatus } from "@/codex/protocol/generated/v2/ThreadGoalStatus";
import type { AppServerTurnStatus } from "./turn-reducer";

export function liveGoalElapsedSeconds(params: {
  goal: ThreadGoal;
  observedAtMs: number;
  nowMs: number;
  turnStartedAtMs?: number;
  turnStatus?: AppServerTurnStatus;
}): number {
  const { goal, observedAtMs, nowMs, turnStartedAtMs, turnStatus } = params;
  if (goal.status !== "active" || turnStatus !== "running" || !turnStartedAtMs) {
    return goal.timeUsedSeconds;
  }

  const baselineMs = Math.max(observedAtMs, turnStartedAtMs);
  const activeSeconds = Math.max(0, Math.floor((nowMs - baselineMs) / 1000));
  return goal.timeUsedSeconds + activeSeconds;
}

export function shouldInterruptForGoalPause(
  nextStatus: ThreadGoalStatus,
  turnStatus?: AppServerTurnStatus,
): boolean {
  return nextStatus === "paused" && (turnStatus === "starting" || turnStatus === "running");
}

export async function updateGoalStatusWithTurnControl(params: {
  status: ThreadGoalStatus;
  turnStatus?: AppServerTurnStatus;
  updateGoal: (status: ThreadGoalStatus) => Promise<unknown>;
  interruptTurn?: () => Promise<unknown>;
}): Promise<void> {
  const { status, turnStatus, updateGoal, interruptTurn } = params;
  await updateGoal(status);
  if (shouldInterruptForGoalPause(status, turnStatus) && interruptTurn) {
    await interruptTurn();
  }
}

export function formatGoalElapsedSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Math.trunc(seconds));
  if (safeSeconds < 60) {
    return `${safeSeconds}s`;
  }

  const minutes = Math.trunc(safeSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.trunc(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours >= 24) {
    const days = Math.trunc(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ${remainingMinutes}m`;
  }

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

export function formatGoalTokensCompact(tokens: number): string {
  const value = Math.max(0, Math.trunc(tokens));
  if (value === 0) return "0";
  if (value < 1_000) return String(value);

  const valueFloat = value;
  const [scaled, suffix] =
    value >= 1_000_000_000_000
      ? [valueFloat / 1_000_000_000_000, "T"]
      : value >= 1_000_000_000
        ? [valueFloat / 1_000_000_000, "B"]
        : value >= 1_000_000
          ? [valueFloat / 1_000_000, "M"]
          : [valueFloat / 1_000, "K"];

  const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  const formatted = scaled
    .toFixed(decimals)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return `${formatted}${suffix}`;
}

export function goalStatusLabel(status: ThreadGoalStatus): string {
  switch (status) {
    case "active":
      return "active";
    case "paused":
      return "paused";
    case "blocked":
      return "blocked";
    case "usageLimited":
      return "usage limited";
    case "budgetLimited":
      return "limited by budget";
    case "complete":
      return "complete";
  }
}

export function goalProgressLabel(goal: ThreadGoal): string {
  switch (goal.status) {
    case "active": {
      const usage = activeGoalUsage(goal);
      return usage ? `Pursuing goal (${usage})` : "Pursuing goal";
    }
    case "paused":
      return "Goal paused (/goal resume)";
    case "blocked":
      return "Goal blocked (/goal resume)";
    case "usageLimited":
      return "Goal hit usage limits (/goal resume)";
    case "budgetLimited": {
      const usage = stoppedGoalBudgetUsage(goal);
      return usage ? `Goal unmet (${usage})` : "Goal abandoned";
    }
    case "complete": {
      const usage = completedGoalUsage(goal);
      return usage ? `Goal achieved (${usage})` : "Goal achieved";
    }
  }
}

export function goalObjectiveLabel(goal: ThreadGoal): string {
  return goal.objective.trim() || "Untitled goal";
}

export function goalSummaryLines(goal: ThreadGoal): string[] {
  const lines = [
    "Goal",
    `Status: ${goalStatusLabel(goal.status)}`,
    `Objective: ${goal.objective}`,
    `Time used: ${formatGoalElapsedSeconds(goal.timeUsedSeconds)}`,
    `Tokens used: ${formatGoalTokensCompact(goal.tokensUsed)}`,
  ];

  if (goal.tokenBudget !== null) {
    lines.push(`Token budget: ${formatGoalTokensCompact(goal.tokenBudget)}`);
  }

  lines.push("", goalCommandsHint(goal.status));
  return lines;
}

export function editedGoalStatus(status: ThreadGoalStatus): ThreadGoalStatus {
  switch (status) {
    case "active":
    case "paused":
    case "blocked":
    case "usageLimited":
      return status;
    case "budgetLimited":
    case "complete":
      return "active";
  }
}

function activeGoalUsage(goal: ThreadGoal): string | null {
  if (goal.tokenBudget !== null) {
    return `${formatGoalTokensCompact(goal.tokensUsed)} / ${formatGoalTokensCompact(goal.tokenBudget)}`;
  }
  return formatGoalElapsedSeconds(goal.timeUsedSeconds);
}

function stoppedGoalBudgetUsage(goal: ThreadGoal): string | null {
  if (goal.tokenBudget === null) return null;
  return `${formatGoalTokensCompact(goal.tokensUsed)} / ${formatGoalTokensCompact(goal.tokenBudget)} tokens`;
}

function completedGoalUsage(goal: ThreadGoal): string | null {
  if (goal.tokenBudget !== null) {
    return `${formatGoalTokensCompact(goal.tokensUsed)} tokens`;
  }
  return formatGoalElapsedSeconds(goal.timeUsedSeconds);
}

function goalCommandsHint(status: ThreadGoalStatus): string {
  switch (status) {
    case "active":
      return "Commands: /goal edit, /goal pause, /goal clear";
    case "paused":
    case "blocked":
    case "usageLimited":
      return "Commands: /goal edit, /goal resume, /goal clear";
    case "budgetLimited":
    case "complete":
      return "Commands: /goal edit, /goal clear";
  }
}
