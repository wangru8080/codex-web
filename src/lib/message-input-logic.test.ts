import { describe, expect, it } from "vitest";

import {
  GOAL_PROMPT_PLACEHOLDER,
  PLAN_PROMPT_PLACEHOLDER,
  goalCommandFromPrompt,
  planPromptFromInput,
} from "./message-input-logic";

describe("message-input-logic goal prompt", () => {
  it("把 composer goal 输入转换成 /goal 命令", () => {
    expect(goalCommandFromPrompt(" 完成 Phase 6V 自动回归 ")).toBe(
      "/goal 完成 Phase 6V 自动回归",
    );
  });

  it("空 goal 输入不产生命令", () => {
    expect(goalCommandFromPrompt("   ")).toBeNull();
  });

  it("暴露目标输入 placeholder", () => {
    expect(GOAL_PROMPT_PLACEHOLDER).toBe("描述你的目标，定义可衡量的成果，以获得最佳效果");
  });
});

describe("message-input-logic plan prompt", () => {
  it("把 composer plan 输入规范成任务提示", () => {
    expect(planPromptFromInput(" 生成 Phase 6V 回归计划 ")).toBe(
      "生成 Phase 6V 回归计划",
    );
  });

  it("空 plan 输入不产生任务提示", () => {
    expect(planPromptFromInput("   ")).toBeNull();
  });

  it("暴露计划输入 placeholder", () => {
    expect(PLAN_PROMPT_PLACEHOLDER).toBe("描述你的任务以生成计划...");
  });
});
