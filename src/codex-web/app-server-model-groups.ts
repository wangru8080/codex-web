import type { Model } from "@/codex/protocol/generated/v2/Model";
import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";
import type { ProviderModelGroup } from "@/types";

export const CODEX_ACCOUNT_PROVIDER_ID = "codex_account";

const DEEPSEEK_MODELS: ProviderModelGroup["models"] = [
  {
    value: "deepseek-flash",
    label: "DeepSeek Flash",
    upstreamModelId: "deepseek-flash",
    description: "DeepSeek fast reasoning model",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
    supportedRuntimes: ["codex_runtime"],
    capabilities: {
      reasoning: true,
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      toolUse: true,
    },
  },
  {
    value: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    upstreamModelId: "deepseek-v4-pro",
    description: "DeepSeek frontier model",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
    supportedRuntimes: ["codex_runtime"],
    capabilities: {
      reasoning: true,
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      toolUse: true,
    },
  },
];

function customModelToOption(modelId: string, description?: string): ProviderModelGroup["models"][number] {
  return {
    value: modelId,
    label: modelId,
    upstreamModelId: modelId,
    description: description || `Custom model (${modelId})`,
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
    supportedRuntimes: ["codex_runtime"],
    capabilities: {
      reasoning: true,
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
      toolUse: true,
    },
  };
}

export function appServerModelsToProviderGroup(
  response: ModelListResponse | null | undefined,
  configResponse?: ConfigReadResponse | null,
): ProviderModelGroup | null {
  const configuredProvider = configResponse?.config.model_provider?.trim() || "";
  const configuredModel = configResponse?.config.model?.trim() || "";
  const isDeepSeek =
    configuredProvider.toLowerCase() === "deepseek" ||
    configuredModel.toLowerCase().startsWith("deepseek");

  if (isDeepSeek) {
    const models: ProviderModelGroup["models"] = [...DEEPSEEK_MODELS];
    if (configuredModel) {
      const existingIdx = models.findIndex(
        (m) => m.value === configuredModel || m.upstreamModelId === configuredModel,
      );
      if (existingIdx > 0) {
        const [item] = models.splice(existingIdx, 1);
        models.unshift(item);
      } else if (existingIdx === -1) {
        models.unshift(customModelToOption(configuredModel));
      }
    }
    return {
      provider_id: CODEX_ACCOUNT_PROVIDER_ID,
      provider_name: "DeepSeek (Codex)",
      provider_type: "codex",
      compat: "codex_account",
      models,
    };
  }

  // If a non-OpenAI provider is explicitly configured, never expose incompatible OpenAI catalog models
  if (configuredProvider && configuredProvider.toLowerCase() !== "openai") {
    const customModels: ProviderModelGroup["models"] = configuredModel
      ? [customModelToOption(configuredModel)]
      : [];
    if (customModels.length === 0) return null;
    return {
      provider_id: CODEX_ACCOUNT_PROVIDER_ID,
      provider_name: `Codex (${configuredProvider})`,
      provider_type: "codex",
      compat: "codex_account",
      models: customModels,
    };
  }

  const rawModels = response?.data.filter((model) => !model.hidden) ?? [];
  let modelOptions = rawModels.map(appServerModelToOption);

  if (configuredModel) {
    const exists = modelOptions.some(
      (m) => m.value === configuredModel || m.upstreamModelId === configuredModel,
    );
    if (!exists) {
      modelOptions = [customModelToOption(configuredModel), ...modelOptions];
    }
  }

  if (modelOptions.length === 0) return null;

  const providerName = configuredProvider
    ? `Codex (${configuredProvider})`
    : "Codex Account";

  return {
    provider_id: CODEX_ACCOUNT_PROVIDER_ID,
    provider_name: providerName,
    provider_type: "codex",
    compat: "codex_account",
    models: modelOptions,
  };
}

function appServerModelToOption(model: Model): ProviderModelGroup["models"][number] {
  const supportedEffortLevels = model.supportedReasoningEfforts
    .map((entry) => entry.reasoningEffort)
    .filter((effort): effort is string => typeof effort === "string" && effort.length > 0);

  return {
    value: model.id,
    label: model.displayName || model.id,
    upstreamModelId: model.model,
    description: model.description || undefined,
    supportsEffort: supportedEffortLevels.length > 0,
    supportedEffortLevels,
    supportedRuntimes: ["codex_runtime"],
    capabilities: {
      reasoning: supportedEffortLevels.length > 0,
      supportsEffort: supportedEffortLevels.length > 0,
      supportedEffortLevels,
      toolUse: true,
    },
  };
}
