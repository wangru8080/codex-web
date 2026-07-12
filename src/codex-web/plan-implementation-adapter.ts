export const PLAN_IMPLEMENTATION_TITLE = "Implement this plan?";
export const PLAN_IMPLEMENTATION_YES = "Yes, implement this plan";
export const PLAN_IMPLEMENTATION_CLEAR_CONTEXT = "Yes, clear context and implement";
export const PLAN_IMPLEMENTATION_NO = "No, stay in Plan mode";
export const PLAN_IMPLEMENTATION_CODING_MESSAGE = "Implement the plan.";
export const PLAN_IMPLEMENTATION_CLEAR_CONTEXT_PREFIX =
  "A previous agent produced the plan below to accomplish the user's task. " +
  "Implement the plan in a fresh context. Treat the plan as the source of " +
  "user intent, re-read files as needed, and carry the work through " +
  "implementation and verification.";
export const PLAN_IMPLEMENTATION_DEFAULT_UNAVAILABLE = "Default mode unavailable";
export const PLAN_IMPLEMENTATION_NO_APPROVED_PLAN = "No approved plan available";

export type PlanImplementationActionId = "implement" | "clearContext" | "stay";

export type PlanImplementationAction = {
  id: PlanImplementationActionId;
  label: string;
  description: string;
  userMessage?: string;
  disabledReason?: string;
};

export type PlanImplementationPrompt = {
  title: typeof PLAN_IMPLEMENTATION_TITLE;
  actions: PlanImplementationAction[];
};

export type SelectPlanImplementationPromptInput = {
  mode: string;
  isHistoryReplay: boolean;
  turnCompleted: boolean;
  proposedPlanMarkdown: string | null | undefined;
  hasQueuedMessage: boolean;
  defaultModeAvailable: boolean;
  clearContextUsageLabel?: string | null;
};

export function selectPlanImplementationPrompt(
  input: SelectPlanImplementationPromptInput,
): PlanImplementationPrompt | null {
  const planMarkdown = input.proposedPlanMarkdown?.trim() ?? "";
  if (
    input.mode !== "plan" ||
    input.isHistoryReplay ||
    !input.turnCompleted ||
    !planMarkdown ||
    input.hasQueuedMessage
  ) {
    return null;
  }

  const unavailable = input.defaultModeAvailable
    ? undefined
    : PLAN_IMPLEMENTATION_DEFAULT_UNAVAILABLE;
  const clearDescription = input.clearContextUsageLabel
    ? `Fresh thread. Context: ${input.clearContextUsageLabel}.`
    : "Fresh thread with this plan.";

  return {
    title: PLAN_IMPLEMENTATION_TITLE,
    actions: [
      {
        id: "implement",
        label: PLAN_IMPLEMENTATION_YES,
        description: "Switch to Default and start coding.",
        userMessage: input.defaultModeAvailable ? PLAN_IMPLEMENTATION_CODING_MESSAGE : undefined,
        disabledReason: unavailable,
      },
      {
        id: "clearContext",
        label: PLAN_IMPLEMENTATION_CLEAR_CONTEXT,
        description: clearDescription,
        userMessage: input.defaultModeAvailable
          ? `${PLAN_IMPLEMENTATION_CLEAR_CONTEXT_PREFIX}\n\n${planMarkdown}`
          : undefined,
        disabledReason: unavailable,
      },
      {
        id: "stay",
        label: PLAN_IMPLEMENTATION_NO,
        description: "Continue planning with the model.",
      },
    ],
  };
}
