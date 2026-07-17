import { describe, expect, it } from "vitest";

import {
  GOAL_PROMPT_PLACEHOLDER,
  PLAN_PROMPT_PLACEHOLDER,
  goalCommandFromPrompt,
  planPromptFromInput,
  detectPopoverTrigger,
  resolveItemSelection,
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

describe("message-input-logic composer 触发模式", () => {
  it("分别识别命令、技能和文件触发符", () => {
    expect(detectPopoverTrigger("/mod", 4)).toEqual({ mode: "command", filter: "mod", triggerPos: 0 });
    expect(detectPopoverTrigger("$wri", 4)).toEqual({ mode: "skill", filter: "wri", triggerPos: 0 });
    expect(detectPopoverTrigger("@AGE", 4)).toEqual({ mode: "file", filter: "AGE", triggerPos: 0 });
  });

  it("普通路径不会误触发命令或技能", () => {
    expect(detectPopoverTrigger("src/app/page.tsx", 16)).toBeNull();
    expect(detectPopoverTrigger("price$usd", 9)).toBeNull();
  });

  it("技能选择生成结构化技能 badge 并移除 $ 查询文本", () => {
    const result = resolveItemSelection({
      label: "Writing Plans",
      value: "/writing-plans",
      description: "编写执行计划",
      kind: "agent_skill",
      skillPath: "/skills/writing-plans/SKILL.md",
    }, "skill", 0, "$wri 请规划", "wri");

    expect(result.action).toBe("set_badge");
    expect(result.badge?.skillPath).toBe("/skills/writing-plans/SKILL.md");
    expect(result.newInputValue).toBe(" 请规划");
  });

  it("文件选择保留 @ 引用语义", () => {
    const result = resolveItemSelection({ label: "AGENTS.md", value: "AGENTS.md", nodeType: "file" }, "file", 0, "@AGE 请分析", "AGE");
    expect(result).toMatchObject({ action: "insert_file_mention", newInputValue: "@AGENTS.md  请分析" });
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
