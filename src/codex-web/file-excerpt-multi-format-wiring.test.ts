import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("多格式文件片段接线", () => {
  const editor = readFileSync(resolve(process.cwd(), "src/components/editor/MarkdownEditor.tsx"), "utf8");
  const preview = readFileSync(resolve(process.cwd(), "src/components/layout/panels/PreviewPanel.tsx"), "utf8");

  it("CodeMirror 对非空选区报告正文和 1-based 行号", () => {
    expect(editor).toContain("onSelectionChange?:");
    expect(editor).toContain("u.selectionSet || u.docChanged");
    expect(editor).toContain("state.doc.lineAt(from).number");
    expect(editor).toContain("state.doc.lineAt(Math.max(from, to - 1)).number");
    expect(editor).toContain("state.sliceDoc(from, to)");
  });

  it("PreviewPanel 在 CodeMirror 上方复用片段工具栏", () => {
    expect(preview).toContain("setEditorSelection");
    expect(preview).toContain("onSelectionChange={setEditorSelection}");
    expect(preview).toContain("<FileSelectionToolbar filePath={filePath} selection={editorSelection}");
  });

  it("代码和 JSON 等非可编辑文本通过 SourceView 工具栏", () => {
    expect(preview).toContain("<SourceView preview={freshPreview} isDark={isDark} />");
    expect(preview).toContain("sourceLineRangeFromDom");
    expect(preview).toContain("lineProps={sourceLineProps}");
  });
});
