import type { TurnPlanStep } from "@/codex/protocol/generated/v2/TurnPlanStep";
import type { TurnPlanUpdatedNotification } from "@/codex/protocol/generated/v2/TurnPlanUpdatedNotification";
import type { MessageContentBlock } from "@/types";

export type PlanSourceBreadcrumb =
  | "app-server.item/plan/delta"
  | "app-server.item/completed"
  | "app-server.thread/read"
  | "app-server.thread/turns/list"
  | "app-server.turn/plan/updated";

export function proposedPlanBlockFromText(
  text: string,
  source: PlanSourceBreadcrumb,
): MessageContentBlock | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return {
    type: "codex_proposed_plan",
    text: trimmed,
    sourceBreadcrumb: source,
  };
}

export function updatedPlanBlockFromNotification(
  notification: TurnPlanUpdatedNotification,
  source: PlanSourceBreadcrumb,
): MessageContentBlock {
  return {
    type: "codex_updated_plan",
    explanation: notification.explanation?.trim() || null,
    steps: notification.plan.map((item) => ({
      step: item.step,
      status: item.status,
    })),
    sourceBreadcrumb: source,
    progress: planProgressFromSteps(notification.plan),
  };
}

export function planProgressFromSteps(steps: TurnPlanStep[]): { completed: number; total: number } | null {
  if (steps.length === 0) return null;
  return {
    completed: steps.filter((step) => step.status === "completed").length,
    total: steps.length,
  };
}
