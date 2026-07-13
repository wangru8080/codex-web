import type { Model } from "@/codex/protocol/generated/v2/Model";
import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import type { ProviderModelGroup } from "@/types";

export const CODEX_ACCOUNT_PROVIDER_ID = "codex_account";

export function appServerModelsToProviderGroup(
  response: ModelListResponse | null | undefined,
): ProviderModelGroup | null {
  const models = response?.data.filter((model) => !model.hidden) ?? [];
  if (models.length === 0) return null;

  return {
    provider_id: CODEX_ACCOUNT_PROVIDER_ID,
    provider_name: "Codex Account",
    provider_type: "codex",
    compat: "codex_account",
    models: models.map(appServerModelToOption),
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
