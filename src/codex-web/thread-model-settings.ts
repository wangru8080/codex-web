import type { CollaborationMode } from "@/codex/protocol/generated/CollaborationMode";
import type { ReasoningEffort } from "@/codex/protocol/generated/ReasoningEffort";
import type { ThreadSettings } from "@/codex/protocol/generated/v2/ThreadSettings";

export type ThreadModelSettings = {
  model: string;
  effort: ReasoningEffort | null;
};

export type ThreadModelSettingsUpdate = {
  threadId: string;
  model?: string;
  effort?: ReasoningEffort;
  collaborationMode?: CollaborationMode;
};

export function modelSettingsFromResume(response: {
  model: string;
  reasoningEffort: ReasoningEffort | null;
}): ThreadModelSettings {
  return {
    model: response.model,
    effort: response.reasoningEffort,
  };
}

export function buildThreadModelSettingsUpdate({
  threadId,
  model,
  effort,
  currentSettings,
}: {
  threadId: string;
  model?: string;
  effort?: ReasoningEffort;
  currentSettings?: ThreadSettings;
}): ThreadModelSettingsUpdate {
  const collaborationMode = currentSettings
    ? {
        ...currentSettings.collaborationMode,
        settings: {
          ...currentSettings.collaborationMode.settings,
          model: model ?? currentSettings.model,
          reasoning_effort: effort ?? currentSettings.effort,
        },
      }
    : undefined;

  return {
    threadId,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(collaborationMode ? { collaborationMode } : {}),
  };
}
