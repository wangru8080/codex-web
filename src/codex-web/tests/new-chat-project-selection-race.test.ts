import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("新聊天项目选择竞态", () => {
  const page = readFileSync(resolve(process.cwd(), "src/app/chat/page.tsx"), "utf8");

  it("用户选择项目后会阻止旧初始化覆盖选择", () => {
    expect(page).toContain("const initializationVersion = workingDirectorySelectionVersionRef.current");
    expect(page).toContain("workingDirectorySelectionVersionRef.current === initializationVersion");
    expect(page).toMatch(
      /const handler = \(e: Event\) => \{[\s\S]*workingDirectorySelectionVersionRef\.current \+= 1;[\s\S]*setWorkingDir\(path\);[\s\S]*\};/,
    );
  });

  it("侧栏项目事件监听独立于只执行一次的初始化", () => {
    const initialization = page.slice(
      page.indexOf("// 初始化工作目录"),
      page.indexOf("// 侧栏项目切换监听"),
    );
    const projectSelectionListener = page.slice(
      page.indexOf("// 侧栏项目切换监听"),
      page.indexOf("// 最近项目来自"),
    );

    expect(initialization).not.toContain("project-directory-changed");
    expect(projectSelectionListener).toContain("window.addEventListener('project-directory-changed', handler)");
    expect(projectSelectionListener).toContain("}, []);");
  });

  it("项目选择器和清除操作也会使旧初始化失效", () => {
    expect(page).toMatch(/handleSelectProject[\s\S]*workingDirectorySelectionVersionRef\.current \+= 1/);
    expect(page).toMatch(/handleClearProject[\s\S]*workingDirectorySelectionVersionRef\.current \+= 1/);
  });

  it("选择器的三条路径会立即同步共享 PanelContext", () => {
    expect(page).toMatch(/handleFolderPickerSelect[\s\S]*setWorkingDir\(path\);[\s\S]*setWorkingDirectory\(path\);/);
    expect(page).toMatch(/handleSelectProject[\s\S]*setWorkingDir\(path\);[\s\S]*setWorkingDirectory\(path\);/);
    expect(page).toMatch(/handleClearProject[\s\S]*setWorkingDir\(''\);[\s\S]*setWorkingDirectory\(''\);/);
  });

  it("会把全局 PanelContext 的项目同步到新对话发送状态", () => {
    expect(page).toContain("workingDirectory: panelWorkingDirectory");
    expect(page).toContain("if (panelWorkingDirectory !== workingDir) setWorkingDir(panelWorkingDirectory);");
  });
});
