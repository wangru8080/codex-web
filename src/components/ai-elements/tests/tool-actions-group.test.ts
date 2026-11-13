import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  resolveThinkingExpanded,
  splitThinkingContent,
  ToolActionsGroup,
  type ToolAction,
} from "../tool-actions-group";

const source = readFileSync(new URL("../tool-actions-group.tsx", import.meta.url), "utf8");

describe("工具过程折叠组", () => {
  it("不依赖不存在的 StickToBottom 上下文", () => {
    expect(source).not.toContain("useStickToBottomContext");
  });

  it("多项工具全部成功时显示处理总数", () => {
    const html = renderTools([
      { name: "Bash", input: { command: "pwd" }, result: "/repo" },
      { name: "Bash", input: { command: "git status" }, result: "clean" },
    ]);

    expect(html).toContain("已处理 2 项");
    expect(html).not.toContain("项失败");
  });

  it("多项工具部分失败时明确失败数量", () => {
    const html = renderTools([
      { name: "Bash", input: { command: "pwd" }, result: "/repo" },
      { name: "Bash", input: { command: "docker ps" }, result: "permission denied", isError: true },
      { name: "Bash", input: { command: "docker ps" }, result: "container" },
    ]);

    expect(html).toContain("已处理 3 项 · 1 项失败");
    expect(html).not.toContain("处理遇到问题");
  });

  it("单项工具失败时保留具体动作状态", () => {
    const html = renderTools([
      { name: "Bash", input: { command: "false" }, result: "exit code: 1", isError: true },
    ]);

    expect(html).toContain("运行失败");
    expect(html).not.toContain("已处理 1 项");
  });

  it("仅有结构化标题时不再生成重复正文", () => {
    const title = "Planning copy, build, and start with updated ports";
    expect(splitThinkingContent(`**${title}**`, true)).toEqual({
      summary: title,
      body: "",
    });

    const html = renderToStaticMarkup(createElement(ToolActionsGroup, {
      tools: [],
      thinkingContent: `**${title}**`,
      isStreaming: true,
      defaultExpanded: true,
    }));
    expect(html.split(title)).toHaveLength(2);
    expect(html).toContain("disabled=\"\"");
  });

  it("结构化标题和正文分开显示", () => {
    expect(splitThinkingContent("**检查构建配置**\n\n接下来核对端口设置。", true)).toEqual({
      summary: "检查构建配置",
      body: "接下来核对端口设置。",
    });
  });

  it("流式正文后续到达时自动展开，并保留用户手动选择", () => {
    const titleOnly = splitThinkingContent("**检查构建配置**", true);
    const withBody = splitThinkingContent("**检查构建配置**\n\n接下来核对端口设置。", true);

    expect(resolveThinkingExpanded(titleOnly.body.length > 0, true, null)).toBe(false);
    expect(resolveThinkingExpanded(withBody.body.length > 0, true, null)).toBe(true);
    expect(resolveThinkingExpanded(withBody.body.length > 0, true, false)).toBe(false);
    expect(resolveThinkingExpanded(withBody.body.length > 0, false, null)).toBe(false);
  });

  it("普通思考内容完整保留为正文", () => {
    expect(splitThinkingContent("先检查配置，再运行构建。", false)).toEqual({
      summary: "思考过程",
      body: "先检查配置，再运行构建。",
    });
  });
});

import { I18nContext } from "../../layout/I18nProvider";

function renderTools(tools: ToolAction[], locale = "zh"): string {
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: { locale: locale as any, setLocale: () => {}, t: (k) => k } },
      createElement(ToolActionsGroup, { tools }),
    ),
  );
}
