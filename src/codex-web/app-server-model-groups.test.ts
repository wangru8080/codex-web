import { describe, expect, it } from "vitest";

import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import { appServerModelsToProviderGroup } from "./app-server-model-groups";

const baseModel = {
  id: "gpt-5.6-sol",
  model: "gpt-5.6-sol",
  upgrade: null,
  upgradeInfo: null,
  availabilityNux: null,
  displayName: "5.6 Sol",
  description: "Codex model",
  hidden: false,
  supportedReasoningEfforts: [
    { reasoningEffort: "low", description: "Low" },
    { reasoningEffort: "high", description: "High" },
  ],
  defaultReasoningEffort: "high",
  inputModalities: [],
  supportsPersonality: false,
  additionalSpeedTiers: [],
  serviceTiers: [],
  defaultServiceTier: null,
  isDefault: true,
} satisfies ModelListResponse["data"][number];

describe("appServerModelsToProviderGroup", () => {
  it("maps visible app-server models to the Codex provider group", () => {
    const group = appServerModelsToProviderGroup({
      data: [baseModel],
      nextCursor: null,
    });

    expect(group?.provider_id).toBe("codex_account");
    expect(group?.provider_type).toBe("codex");
    expect(group?.models).toEqual([
      expect.objectContaining({
        value: "gpt-5.6-sol",
        label: "5.6 Sol",
        upstreamModelId: "gpt-5.6-sol",
        supportedEffortLevels: ["low", "high"],
        supportedRuntimes: ["codex_runtime"],
      }),
    ]);
  });

  it("filters hidden models and returns null when nothing is visible", () => {
    const group = appServerModelsToProviderGroup({
      data: [{ ...baseModel, hidden: true }],
      nextCursor: null,
    });

    expect(group).toBeNull();
  });
});
