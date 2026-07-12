import { describe, expect, it } from "vitest";

import {
  PLAN_IMPLEMENTATION_CODING_MESSAGE,
  PLAN_IMPLEMENTATION_DEFAULT_UNAVAILABLE,
  PLAN_IMPLEMENTATION_TITLE,
  selectPlanImplementationPrompt,
} from "./plan-implementation-adapter";

describe("plan-implementation-adapter", () => {
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
