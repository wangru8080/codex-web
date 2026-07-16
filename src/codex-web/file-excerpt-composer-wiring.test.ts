import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("文件片段加入对话接线", () => {
  const preview = readFileSync(resolve(process.cwd(), "src/components/layout/panels/PreviewPanel.tsx"), "utf8");
  const input = readFileSync(resolve(process.cwd(), "src/components/chat/MessageInput.tsx"), "utf8");
  const parts = readFileSync(resolve(process.cwd(), "src/components/chat/MessageInputParts.tsx"), "utf8");
  const toolbar = readFileSync(resolve(process.cwd(), "src/components/editor/FileSelectionToolbar.tsx"), "utf8");

  it("预览使用源 Markdown 和 frontmatter 偏移计算行号", () => {
    expect(toolbar).toContain("locateExcerptLines");
    expect(preview).toContain("sourceText: body");
    expect(preview).toContain("lineOffset,");
    expect(toolbar).toContain("startLine: lines?.startLine");
    expect(toolbar).toContain("endLine: lines?.endLine");
  });

  it("输入框监听结构化片段且不再把引用正文写入 textarea", () => {
    expect(input).toContain("setFileExcerptReferences");
    expect(input).toContain("isAddToChatDetail");
    expect(input).not.toContain("const quote = d.text");
    expect(input).toContain("<FileExcerptCapsules");
  });

  it("发送时分离模型内容和展示内容，失败时恢复片段卡片", () => {
    expect(input).toContain("buildFileExcerptPrompt");
    expect(input).toContain("encodeFileExcerptDisplay");
    expect(input).toContain("restoreExcerpts");
    expect(input).toContain("setFileExcerptReferences([])");
  });

  it("片段卡片显示文件名、类型和起止行", () => {
    expect(parts).toContain("export function FileExcerptCapsules");
    expect(parts).toContain("excerpt.startLine");
    expect(parts).toContain("excerpt.endLine");
    expect(parts).toContain("data-file-excerpt-path");
  });

  it("Markdown 和普通源码共用文件选区工具栏", () => {
    expect(toolbar).toContain("export function FileSelectionToolbar");
    expect(toolbar).toContain("export function useDomFileSelection");
    expect(preview.match(/<FileSelectionToolbar/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("普通源码高亮行携带真实源行号", () => {
    expect(preview).toContain("wrapLines");
    expect(preview).toContain('"data-source-line": String(lineNumber)');
    expect(preview).toContain("sourceLineRangeFromDom");
  });
});
