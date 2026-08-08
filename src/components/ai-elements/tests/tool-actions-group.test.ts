import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolActionsGroup, type ToolAction } from "../tool-actions-group";

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
});

function renderTools(tools: ToolAction[]): string {
  return renderToStaticMarkup(createElement(ToolActionsGroup, { tools }));
}
