import type { ReasoningEffort } from "@/codex/protocol/generated/ReasoningEffort";
import type { TurnStartParams } from "@/codex/protocol/generated/v2/TurnStartParams";

export function withReasoningEffort<T extends TurnStartParams>(
  params: T,
  effort: ReasoningEffort | "auto" | undefined,
): T {
  if (!effort || effort === "auto") {
    return params;
  }
  return { ...params, effort };
}
