import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("最小 app-server Git 面板接线", () => {
  const panel = read("src/components/git/GitPanel.tsx");
  const status = read("src/components/git/GitStatusSection.tsx");
  const dialog = read("src/components/git/CommitDialog.tsx");
  const hook = read("src/hooks/useGitWorkspace.ts");
  const appShell = read("src/components/layout/AppShell.tsx");

  it("状态、diff 和提交都使用 app-server command/exec", () => {
    expect(panel).toContain("useGitWorkspace(workingDirectory)");
    expect(panel).toContain('data-source-breadcrumb="app-server.command/exec"');
    expect(hook).toContain("execCommand({");
    expect(hook).toContain("sandboxPolicy: { type: 'readOnly' as const, networkAccess: false }");
    expect(hook).toContain("type: 'workspaceWrite' as const");
    expect(hook).toContain("networkAccess: false");
    expect(hook).toContain("['git', 'rev-parse', '--absolute-git-dir']");
    expect(hook).toContain("['git', 'rev-parse', '--path-format=absolute', '--git-common-dir']");
    expect(appShell).toContain("useGitWorkspace(workingDirectory, false)");
    expect(appShell).not.toContain("useGitStatus");
  });

  it("文件选择、diff 预览和提交后刷新形成闭环", () => {
    expect(status).toContain('type="checkbox"');
    expect(panel).toContain("const diff = await git.readDiff(file)");
    expect(panel).toContain("kind: 'inline-diff'");
    expect(panel).toContain("selectedPaths.has(file.path)");
    expect(hook).toContain("buildGitCommitCommands(files, trimmed)");
    expect(hook).toContain("window.dispatchEvent(new CustomEvent('git-refresh'))");
    expect(dialog).toContain("files.length === 0 || committing");
  });

  it("不再暴露失效或延后的完整 Git 客户端操作", () => {
    const source = `${panel}\n${status}\n${dialog}\n${hook}`;
    expect(source).not.toContain("/api/git/");
    expect(source).not.toContain("GitBranchSelector");
    expect(source).not.toContain("GitHistorySection");
    expect(source).not.toContain("GitWorktreeSection");
    expect(source).not.toContain("commit-and-push");
  });
});
