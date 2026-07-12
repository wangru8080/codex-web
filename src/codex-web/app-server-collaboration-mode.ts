import type { CollaborationMode } from "@/codex/protocol/generated/CollaborationMode";
import type { ThreadStartParams } from "@/codex/protocol/generated/v2/ThreadStartParams";
import type { TurnStartParams } from "@/codex/protocol/generated/v2/TurnStartParams";
import type {
  ThreadStartParamsWithCollaborationMode,
  TurnStartParamsWithCollaborationMode,
} from "./app-server-request-overrides";

export function planCollaborationModeForRequest(
  mode: string | undefined,
  model: string | null | undefined,
): CollaborationMode | null {
  if (mode !== "plan") {
    return null;
  }

  return {
    mode: "plan",
    settings: {
      model: model ?? "",
      reasoning_effort: null,
      developer_instructions: null,
    },
  };
}

export function withPlanCollaborationMode(
  params: ThreadStartParams,
  mode: string | undefined,
  model: string | null | undefined,
): ThreadStartParamsWithCollaborationMode;
export function withPlanCollaborationMode(
  params: TurnStartParams,
  mode: string | undefined,
  model: string | null | undefined,
): TurnStartParamsWithCollaborationMode;
export function withPlanCollaborationMode(
  params: ThreadStartParams | TurnStartParams,
  mode: string | undefined,
  model: string | null | undefined,
): ThreadStartParamsWithCollaborationMode | TurnStartParamsWithCollaborationMode {
  const collaborationMode = planCollaborationModeForRequest(mode, model);
  if (!collaborationMode) {
    return params;
  }

  return {
    ...params,
    collaborationMode,
  };
}
