import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("app-server 文件树接线", () => {
  const tree = readFileSync(resolve(process.cwd(), "src/components/project/FileTree.tsx"), "utf8");
  const primitive = readFileSync(resolve(process.cwd(), "src/components/ai-elements/file-tree.tsx"), "utf8");
  const zh = readFileSync(resolve(process.cwd(), "src/i18n/zh.ts"), "utf8");

  it("目录加载使用 app-server 而非缺失的 /api/files", () => {
    expect(tree).toContain("useAppServerActions");
    expect(tree).toContain("readDirectory(");
    expect(tree).not.toContain("/api/files?");
  });

  it("文件节点提供三项右键操作", () => {
    expect(primitive).toContain("ContextMenuPrimitive.Root");
    expect(primitive).toContain("onCopyPath");
    expect(primitive).toContain("onOpenContainingDirectory");
    expect(primitive).toContain("onInsertReference");
    expect(zh).toContain("'fileTree.copyPath': '复制路径'");
    expect(zh).toContain("'fileTree.openContainingDirectory': '打开所在目录'");
    expect(zh).toContain("'fileTree.insertReference': '插入引用'");
  });

  it("插入引用复用输入框 mention 事件", () => {
    expect(tree).toContain("new CustomEvent('insert-file-reference'");
    expect(tree).not.toContain("new CustomEvent('insert-file-mention'");
  });

  it("复制在 pointer 用户激活阶段执行，目录定位提供可见反馈", () => {
    expect(primitive).toContain("handleCopyPointerDown");
    expect(primitive).toContain("onPointerDown={handleCopyPointerDown}");
    expect(tree).toContain("setRevealPath(parent)");
    expect(tree).toContain("effectiveHighlightPath");
  });
});
