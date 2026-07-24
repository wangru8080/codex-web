import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("聊天重模块按需加载接线", () => {
  it("聊天渲染入口不再静态导入数学与 Mermaid 插件", () => {
    for (const path of [
      "src/components/ai-elements/message.tsx",
      "src/components/ai-elements/reasoning.tsx",
      "src/components/ai-elements/tool-actions-group.tsx",
    ]) {
      const source = read(path);
      expect(source).not.toContain('from "@streamdown/math"');
      expect(source).not.toContain("from '@streamdown/math'");
      expect(source).not.toContain('from "@streamdown/mermaid"');
      expect(source).not.toContain("from '@streamdown/mermaid'");
      expect(source).toContain("useStreamdownPlugins");
    }
  });

  it("可选插件和 Shiki 运行时只通过动态 import 加载", () => {
    const loader = read("src/components/ai-elements/streamdown-plugins.ts");
    const codeBlock = read("src/components/ai-elements/code-block.tsx");

    expect(loader).toContain('import("@streamdown/math")');
    expect(loader).toContain('import("@streamdown/mermaid")');
    expect(loader).toContain('import("./code-block")');
    expect(codeBlock).toContain('import("shiki")');
    expect(codeBlock).not.toContain('import { createHighlighter } from "shiki"');
  });

  it("聊天 Markdown 不覆盖 Streamdown 的代码块与 Mermaid 分派", () => {
    const source = read("src/components/chat/markdown-components.tsx");
    expect(source).not.toMatch(/\n\s*(?:code|pre):\s*Chat/);
  });

  it("Sandpack、CodeMirror 与数据表继续保留独立动态边界", () => {
    const preview = read("src/components/layout/panels/PreviewPanel.tsx");
    expect(preview).toContain('dynamic(\n  () => import("@/components/editor/SandpackPreview")');
    expect(preview).toContain('dynamic(\n  () => import("@/components/editor/MarkdownEditor")');
    expect(preview).toContain('dynamic(\n  () => import("@/components/editor/DataTableViewer")');
  });
});
