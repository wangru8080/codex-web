import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("移动端 AppShell 响应式面板接线", () => {
  const viewportHook = source("src/hooks/useCompactViewport.ts");
  const shell = source("src/components/layout/AppShell.tsx");
  const panelZone = source("src/components/layout/PanelZone.tsx");
  const topBar = source("src/components/layout/UnifiedTopBar.tsx");
  const chatPage = source("src/app/chat/[id]/page.tsx");

  it("使用统一 1024px 断点并区分 hydration 未知状态", () => {
    expect(viewportHook).toContain('COMPACT_VIEWPORT_QUERY = "(max-width: 1023px)"');
    expect(viewportHook).toContain("boolean | null");
    expect(viewportHook).toContain("window.matchMedia(COMPACT_VIEWPORT_QUERY)");
  });

  it("移动端三个侧栏使用 Sheet 而不占用主内容 flex 宽度", () => {
    expect(shell).toContain("compactViewport ? (");
    expect(shell).toContain("if (compactViewportConfirmed) setWorkspaceOpen(false)");
    expect(shell).toContain("if (compactViewportState !== true) return");
    expect(shell).toContain('side="left"');
    expect(shell).toContain('side="right"');
    expect(shell).toContain("<PanelZone compactViewport={compactViewport}");
    expect(panelZone).toContain("compactViewport: boolean");
    expect(panelZone).toContain('side="right"');
  });

  it("移动端顶部按钮互斥，桌面仍保留 additive 语义", () => {
    expect(topBar).toContain("const compactViewport = useCompactViewport()");
    expect(topBar).toContain("if (nextOpen && compactViewport)");
    expect(topBar).toContain("ws?.setOpen(false)");
    expect(topBar).toContain("setFileTreeOpen(false)");
    expect(topBar).toContain("setChatListOpen(false)");
    expect(topBar).toContain("v13: file-tree and Workspace Sidebar are additive");
  });

  it("移动普通会话不自动打开默认右栏，显式文件深链仍保留", () => {
    expect(chatPage).toContain("const compactViewport = useCompactViewport()");
    expect(chatPage).toContain("if (compactViewport === null) return");
    expect(chatPage).toContain("if (compactViewport && !targetFilePath)");
    expect(chatPage).toContain("if (targetFilePath)");
  });
});
