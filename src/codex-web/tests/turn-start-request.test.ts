import { describe, expect, it } from "vitest";

import type { TurnStartParams } from "@/codex/protocol/generated/v2/TurnStartParams";
import { withReasoningEffort } from "../turn-start-request";

const baseParams: TurnStartParams = {
  threadId: "thread-1",
  input: [{ type: "text", text: "测试推理等级", text_elements: [] }],
  model: "gpt-5.5",
};

describe("turn/start reasoning effort", () => {
  it("把输入框选择的 high 写入 turn/start effort", () => {
    expect(withReasoningEffort(baseParams, "high")).toEqual({
      ...baseParams,
      effort: "high",
    });
  });

  it("未显式选择时不覆盖 app-server 配置默认值", () => {
    expect(withReasoningEffort(baseParams, undefined)).toEqual(baseParams);
    expect(withReasoningEffort(baseParams, "auto")).toEqual(baseParams);
  });
});
