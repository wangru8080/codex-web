import { describe, expect, it } from "vitest";

import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";
import type { ModelListResponse } from "@/codex/protocol/generated/v2/ModelListResponse";
import { resolveNewChatModelDefaults } from "./new-chat-model-defaults";

const models = {
  data: [
    {
      id: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      displayName: "GPT-5.6-Sol",
      hidden: false,
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Low" },
        { reasoningEffort: "high", description: "High" },
      ],
      defaultReasoningEffort: "high",
      isDefault: true,
    },
    {
      id: "gpt-5.5",
      model: "gpt-5.5",
      displayName: "GPT-5.5",
      hidden: false,
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Low" },
        { reasoningEffort: "high", description: "High" },
      ],
      defaultReasoningEffort: "high",
      isDefault: false,
    },
  ],
  nextCursor: null,
} as ModelListResponse;

function config(model: string | null, effort: string | null): ConfigReadResponse {
  return {
    config: { model, model_reasoning_effort: effort } as ConfigReadResponse["config"],
    origins: {},
    layers: null,
  };
}

describe("new chat model defaults", () => {
  it("优先使用 config/read 的模型和推理等级", () => {
    expect(resolveNewChatModelDefaults(models, config("gpt-5.5", "low"))).toEqual({
      model: "gpt-5.5",
      effort: "low",
    });
  });

  it("配置模型不可用时回退 model/list 默认模型及其默认 effort", () => {
    expect(resolveNewChatModelDefaults(models, config("missing-model", "low"))).toEqual({
      model: "gpt-5.6-sol",
      effort: "high",
    });
  });

  it("配置 effort 不受支持时使用目标模型默认 effort", () => {
    expect(resolveNewChatModelDefaults(models, config("gpt-5.5", "xhigh"))).toEqual({
      model: "gpt-5.5",
      effort: "high",
    });
  });

  it("无配置时使用 model/list 默认值", () => {
    expect(resolveNewChatModelDefaults(models, null)).toEqual({
      model: "gpt-5.6-sol",
      effort: "high",
    });
  });
});
