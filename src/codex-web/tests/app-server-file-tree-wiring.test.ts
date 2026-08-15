import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("app-server 文件树接线", () => {
  const tree = readFileSync(resolve(process.cwd(), "src/components/project/FileTree.tsx"), "utf8");
  const panel = readFileSync(resolve(process.cwd(), "src/components/layout/panels/FileTreePanel.tsx"), "utf8");
  const chatDetail = readFileSync(resolve(process.cwd(), "src/app/chat/[id]/page.tsx"), "utf8");
  const primitive = readFileSync(resolve(process.cwd(), "src/components/ai-elements/file-tree.tsx"), "utf8");
  const zh = readFileSync(resolve(process.cwd(), "src/i18n/zh.ts"), "utf8");

  it("目录加载使用 app-server 而非缺失的 /api/files", () => {
    expect(tree).toContain("useAppServerActions");
    expect(tree).toContain("readDirectory(");
    expect(tree).not.toContain("/api/files?");
  });

  it("新建文件和目录统一使用 app-server 并阻止同名覆盖", () => {
    expect(panel).toContain("useAppServerActions");
    expect(panel).toContain("readDirectory(targetDir)");
    expect(panel).toContain("directoryContainsName(targetDir, parent.entries, trimmed)");
    expect(panel).toContain("createDirectory(targetPath, false)");
    expect(panel).toContain("await writeFile(");
    expect(panel).toContain("utf8ToBase64(`# ${trimmed.replace(");
    expect(panel).not.toContain("/api/files/write");
    expect(panel).not.toContain("/api/files/mkdir");
    expect(panel).not.toContain("fetch(endpoint");
  });

  it("手动刷新和 fs/changed 使用同一文件树重载入口", () => {
    expect(tree).toContain("watchFileSystem(workingDirectory");
    expect(tree).toContain("dispatchFileChanged({ paths: changedPaths, source: \"external\" })");
    expect(tree).toContain("void fetchTree()");
    expect(tree).toContain("window.addEventListener('refresh-file-tree', handler)");
    expect(tree).toContain("void stopWatching()");
  });

  it("同项目切换会话时保留文件树，由 cwd 真实变化驱动跨项目刷新", () => {
    expect(chatDetail).not.toContain("setWorkingDirectory('');");
    expect(chatDetail).not.toContain("window.dispatchEvent(new Event('refresh-file-tree'));");
    expect(chatDetail).toContain("setWorkingDirectory(session.working_directory);");
    expect(tree).toContain("}, [readDirectory, workingDirectory]);");
  });

  it("文件节点提供复制、下载和添加到对话三项右键操作", () => {
    expect(primitive).toContain("ContextMenuPrimitive.Root");
    expect(primitive).toContain("onCopyPath");
    expect(primitive).toContain("onDownload");
    expect(primitive).toContain("onAddToChat");
    expect(primitive).not.toContain("onInsertReference");
    expect(primitive).not.toContain("onOpenContainingDirectory");
    expect(zh).toContain("'fileTree.copyPath': '复制路径'");
    expect(zh).toContain("'fileTree.download': '下载'");
    expect(zh).toContain("'fileTree.addToChat': '添加到对话'");
    expect(zh).not.toContain("'fileTree.insertReference'");
    expect(zh).not.toContain("'fileTree.openContainingDirectory'");
  });

  it("添加到对话复用输入框文件引用事件", () => {
    expect(tree).toContain("handleAddToChat");
    expect(tree).toContain("onAddToChat={handleAddToChat}");
    expect(tree).not.toContain("handleInsertReference");
    expect(tree).toContain("new CustomEvent('insert-file-reference'");
    expect(tree).not.toContain("new CustomEvent('insert-file-mention'");
  });

  it("附件和 Token 估算不再依赖已删除的文件 API", () => {
    const inputParts = readFileSync(resolve(process.cwd(), "src/components/chat/MessageInputParts.tsx"), "utf8");
    const estimateHook = readFileSync(resolve(process.cwd(), "src/hooks/useMentionTokenEstimate.ts"), "utf8");

    expect(inputParts).toContain("readFileLimited(filePath");
    expect(inputParts).not.toContain("/api/files/raw");
    expect(estimateHook).toContain("getFileSize");
    expect(estimateHook).toContain("readDirectory");
    expect(estimateHook).not.toContain("/api/files/raw");
    expect(estimateHook).not.toContain("/api/files/serve");
    expect(estimateHook).not.toContain("/api/files?");
  });

  it("复制在 pointer 用户激活阶段执行，下载复用 app-server 文件读取", () => {
    expect(primitive).toContain("handleCopyPointerDown");
    expect(primitive).toContain("onPointerDown={handleCopyPointerDown}");
    expect(tree).toContain("await readFile(path)");
    expect(tree).toContain("fileBytesFromResponse(response)");
    expect(tree).toContain("URL.createObjectURL(blob)");
    expect(tree).toContain("link.download = fileNameFromPath(path)");
    expect(tree).toContain("URL.revokeObjectURL(url)");
    expect(tree).not.toContain("/api/files/raw");
  });
});
