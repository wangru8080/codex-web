import type { ReasoningEffort } from "@/codex/protocol/generated/ReasoningEffort";
import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";
import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";

export type NewChatModelDefaults = {
  model: string;
  effort: ReasoningEffort;
};

export function resolveNewChatModelDefaults(
  response: ModelListResponse | null | undefined,
  configResponse: ConfigReadResponse | null | undefined,
): NewChatModelDefaults | null {
  const models = response?.data.filter((model) => !model.hidden) ?? [];
  if (models.length === 0) return null;

  const configuredModel = configResponse?.config.model?.trim() || "";
  const configModel = models.find((model) => (
    configuredModel && (model.id === configuredModel || model.model === configuredModel)
  ));
  const selectedModel = configModel ?? models.find((model) => model.isDefault) ?? models[0];
  const configuredEffort = configuredModel && !configModel
    ? null
    : configResponse?.config.model_reasoning_effort;
  const supportsConfiguredEffort = configuredEffort
    ? selectedModel.supportedReasoningEfforts.some((option) => option.reasoningEffort === configuredEffort)
    : false;

  return {
    model: selectedModel.id,
    effort: configuredEffort && supportsConfiguredEffort
      ? configuredEffort
      : selectedModel.defaultReasoningEffort,
  };
}
