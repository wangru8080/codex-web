import type { CollaborationMode } from "@/codex/protocol/generated/CollaborationMode";

export type AppServerCollaborationModeParams = {
  collaborationMode?: CollaborationMode;
};

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

export function withPlanCollaborationMode<T extends Record<string, unknown>>(
  params: T,
  mode: string | undefined,
  model: string | null | undefined,
): T & AppServerCollaborationModeParams {
  const collaborationMode = planCollaborationModeForRequest(mode, model);
  if (!collaborationMode) {
    return params;
  }

  return {
    ...params,
    collaborationMode,
  };
}
