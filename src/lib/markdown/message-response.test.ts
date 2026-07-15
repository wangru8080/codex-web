import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  MessageResponse,
  StreamingMessageResponse,
} from "../../components/ai-elements/message";
import { PanelContext, type PanelContextValue } from "../../hooks/usePanel";

const completedMarkdown = [
  "页面包括 `/settings/*`。",
  "",
  "补充：项目说明主要散落在 `AGENTS.md` 下。",
].join("\n");

describe("MessageResponse", () => {
  it("完成态不使用流式修补器追加句末星号", () => {
    const html = renderToStaticMarkup(
      React.createElement(MessageResponse, null, completedMarkdown),
    );

    expect(html).toContain("项目说明主要散落在 <code");
    expect(html).toContain("下。</p>");
    expect(html).not.toContain("下。*</p>");
  });

  it("流式渲染保留粗体补全但不误判行内代码中的星号", () => {
    const repairedBold = renderToStaticMarkup(
      React.createElement(StreamingMessageResponse, null, "**处理中"),
    );
    const completed = renderToStaticMarkup(
      React.createElement(StreamingMessageResponse, null, completedMarkdown),
    );

    expect(repairedBold).toContain("<strong");
    expect(repairedBold).toContain("处理中</strong>");
    expect(completed).toContain("下。</p>");
    expect(completed).not.toContain("下。*</p>");
  });

  it("本地文件和远程 URL 渲染为带图标的安全链接", () => {
    const panel = {
      workingDirectory: "/repo",
      setPreviewSource: () => undefined,
    } as unknown as PanelContextValue;
    const markdown = [
      "[websocket-bridge.ts](/repo/server/websocket-bridge.ts#L42)",
      "[OpenAI 文档](https://platform.openai.com/docs)",
    ].join(" ");
    const html = renderToStaticMarkup(
      React.createElement(
        PanelContext.Provider,
        { value: panel },
        React.createElement(MessageResponse, null, markdown),
      ),
    );

    expect(html).toContain('data-codepilot-fileref-path="/repo/server/websocket-bridge.ts"');
    expect(html).toContain('data-codepilot-fileref-anchor="#L42"');
    expect(html).toContain("websocket-bridge.ts");
    expect(html).toContain('href="https://platform.openai.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
