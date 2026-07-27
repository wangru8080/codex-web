import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { translate } from "@/i18n";

import {
  PLAN_IMPLEMENTATION_CODING_MESSAGE,
  PLAN_IMPLEMENTATION_DEFAULT_UNAVAILABLE,
  PLAN_IMPLEMENTATION_TITLE,
  selectPlanImplementationPrompt,
} from "../plan-implementation-adapter";

describe("plan-implementation-adapter", () => {
  it("Plan UI 在中文界面使用中文文案", () => {
    const promptBar = readFileSync(
      resolve(process.cwd(), "src/components/chat/PlanImplementationPromptBar.tsx"),
      "utf8",
    );
    const planBlock = readFileSync(
      resolve(process.cwd(), "src/components/chat/PlanMessageBlock.tsx"),
      "utf8",
    );

    expect(translate("zh", "chat.plan.implementationTitle")).toBe("是否执行此计划？");
    expect(translate("zh", "chat.plan.implement")).toBe("执行此计划");
    expect(translate("zh", "chat.plan.clearContextImplement")).toBe("清空上下文并执行");
    expect(translate("zh", "chat.plan.stay")).toBe("暂不执行，继续规划");
    expect(promptBar).toContain("chat.plan.implementationTitle");
    expect(planBlock).toContain("chat.plan.proposedTitle");
    expect(planBlock).not.toContain(">Proposed Plan<");
  });

  it("非 Plan mode 不显示 prompt", () => {
    expect(prompt({ mode: "code" })).toBeNull();
  });

  it("history replay 不显示 prompt", () => {
    expect(prompt({ isHistoryReplay: true })).toBeNull();
  });

  it("没有 proposed plan 不显示 prompt", () => {
    expect(prompt({ proposedPlanMarkdown: " " })).toBeNull();
  });

  it("有 queued message 不显示 prompt", () => {
    expect(prompt({ hasQueuedMessage: true })).toBeNull();
  });

  it("Plan mode live turn 完成且有 proposed plan 时显示三选项", () => {
    const selected = prompt({});

    expect(selected).toEqual({
      title: PLAN_IMPLEMENTATION_TITLE,
      actions: [
        expect.objectContaining({
          id: "implement",
          label: "Yes, implement this plan",
          userMessage: PLAN_IMPLEMENTATION_CODING_MESSAGE,
        }),
        expect.objectContaining({
          id: "clearContext",
          label: "Yes, clear context and implement",
          userMessage: expect.stringContaining("1. 写测试"),
        }),
        expect.objectContaining({
          id: "stay",
          label: "No, stay in Plan mode",
        }),
      ],
    });
  });

  it("Default mode 不可用时禁用两个 implement 选项", () => {
    const selected = prompt({ defaultModeAvailable: false });

    expect(selected?.actions[0]).toMatchObject({
      id: "implement",
      disabledReason: PLAN_IMPLEMENTATION_DEFAULT_UNAVAILABLE,
      userMessage: undefined,
    });
    expect(selected?.actions[1]).toMatchObject({
      id: "clearContext",
      disabledReason: PLAN_IMPLEMENTATION_DEFAULT_UNAVAILABLE,
      userMessage: undefined,
    });
    expect(selected?.actions[2]?.disabledReason).toBeUndefined();
  });
});

function prompt(
  overrides: Partial<Parameters<typeof selectPlanImplementationPrompt>[0]>,
) {
  return selectPlanImplementationPrompt({
    mode: "plan",
    isHistoryReplay: false,
    turnCompleted: true,
    proposedPlanMarkdown: "1. 写测试\n2. 实现",
    hasQueuedMessage: false,
    defaultModeAvailable: true,
    ...overrides,
  });
}
