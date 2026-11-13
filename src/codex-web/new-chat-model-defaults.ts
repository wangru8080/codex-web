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
  const configuredProvider = configResponse?.config.model_provider?.trim() || "";
  let configuredModel = configResponse?.config.model?.trim() || "";
  const configuredEffort = configResponse?.config.model_reasoning_effort;

  const isDeepSeek =
    configuredProvider.toLowerCase() === "deepseek" ||
    configuredModel.toLowerCase().startsWith("deepseek");

  if (!configuredModel && isDeepSeek) {
    configuredModel = "deepseek-flash";
  }

  if (configuredModel) {
    const configModel = models.find((model) => (
      model.id === configuredModel || model.model === configuredModel
    ));
    if (configModel) {
      const supportsConfiguredEffort = configuredEffort
        ? configModel.supportedReasoningEfforts.some((option) => option.reasoningEffort === configuredEffort)
        : false;
      return {
        model: configModel.id,
        effort: configuredEffort && supportsConfiguredEffort
          ? configuredEffort
          : configModel.defaultReasoningEffort,
      };
    }
    return {
      model: configuredModel,
      effort: configuredEffort || "medium",
    };
  }

  if (models.length === 0) return null;

  const selectedModel = models.find((model) => model.isDefault) ?? models[0];
  if (!selectedModel) return null;

  return {
    model: selectedModel.id,
    effort: selectedModel.defaultReasoningEffort,
  };
}
