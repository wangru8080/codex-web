import { describe, expect, it } from "vitest";

import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import { appServerModelsToProviderGroup } from "../app-server-model-groups";

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
      data: [
        baseModel,
        {
          ...baseModel,
          id: "gpt-5.6-terra",
          model: "gpt-5.6-terra",
          displayName: "5.6 Terra",
          isDefault: false,
        },
        {
          ...baseModel,
          id: "gpt-5.6-luna",
          model: "gpt-5.6-luna",
          displayName: "5.6 Luna",
          isDefault: false,
        },
        {
          ...baseModel,
          id: "codex-auto-review",
          model: "codex-auto-review",
          displayName: "Auto Review",
          hidden: true,
          isDefault: false,
        },
      ],
      nextCursor: null,
    });

    expect(group?.provider_id).toBe("codex_account");
    expect(group?.provider_type).toBe("codex");
    expect(group?.models).toEqual([
      expect.objectContaining({ value: "gpt-5.6-sol", label: "5.6 Sol" }),
      expect.objectContaining({ value: "gpt-5.6-terra", label: "5.6 Terra" }),
      expect.objectContaining({ value: "gpt-5.6-luna", label: "5.6 Luna" }),
    ]);
    expect(group?.models[0]).toEqual(expect.objectContaining({
      upstreamModelId: "gpt-5.6-sol",
      supportedEffortLevels: ["low", "high"],
      supportedRuntimes: ["codex_runtime"],
    }));
  });

  it("filters hidden models and returns null when nothing is visible and no custom model configured", () => {
    const group = appServerModelsToProviderGroup({
      data: [{ ...baseModel, hidden: true }],
      nextCursor: null,
    });

    expect(group).toBeNull();
  });

  it("当配置了 deepseek 时提供 DeepSeek 专用模型列表且不暴露不兼容的 OpenAI 模型", () => {
    const config = {
      config: {
        model: "deepseek-flash",
        model_provider: "deepseek",
        model_reasoning_effort: "medium",
      },
      origins: {},
      layers: null,
    } as any;

    const group = appServerModelsToProviderGroup(
      {
        data: [baseModel],
        nextCursor: null,
      },
      config,
    );

    expect(group).not.toBeNull();
    expect(group?.provider_id).toBe("codex_account");
    expect(group?.provider_name).toBe("DeepSeek (Codex)");
    expect(group?.models.map((m) => m.value)).toEqual([
      "deepseek-flash",
      "deepseek-v4-pro",
    ]);
  });

  it("当配置了自定义模型时将其插入到模型列表首位", () => {
    const config = {
      config: {
        model: "custom-agent-v1",
        model_provider: null,
        model_reasoning_effort: null,
      },
      origins: {},
      layers: null,
    } as any;

    const group = appServerModelsToProviderGroup(
      {
        data: [baseModel],
        nextCursor: null,
      },
      config,
    );

    expect(group).not.toBeNull();
    expect(group?.models[0].value).toBe("custom-agent-v1");
    expect(group?.models[1].value).toBe("gpt-5.6-sol");
  });
});
