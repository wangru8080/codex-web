import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('工作区侧栏 UI 接线', () => {
  it('打开文件后关闭加号菜单', () => {
    const tabBar = source('src/components/layout/WorkspaceSidebar/TabBar.tsx');

    expect(tabBar).toContain('open={toolMenuOpen}');
    expect(tabBar).toContain('setToolMenuOpen(false)');
  });

  it('路径目录点击定位现有文件树', () => {
    const panel = source('src/components/layout/WorkspaceSidebar/TabPanel.tsx');
    const treePanel = source('src/components/layout/panels/FileTreePanel.tsx');

    expect(panel).toContain('setTreeFocus({ path: item.path');
    expect(panel).toContain('focusPath={treeFocus?.path}');
    expect(treePanel).toContain('highlightPath={focusPath ?? highlightPath}');
  });

  it('终端入口接入真实 app-server process，侧边聊天继续保持占位', () => {
    const tabBar = source('src/components/layout/WorkspaceSidebar/TabBar.tsx');
    const panel = source('src/components/layout/WorkspaceSidebar/TabPanel.tsx');
    const terminal = source('src/components/layout/WorkspaceSidebar/TerminalPanel.tsx');
    const frame = source('src/components/layout/WorkspaceSidebar/TerminalFrame.tsx');

    expect(tabBar).toContain('workspaceSidebar.tool.terminal');
    expect(tabBar).toContain('workspaceSidebar.tool.sideChat');
    expect(tabBar).toContain("kind: 'terminal-pinned'");
    expect(panel).toContain('workspaceSidebar.tool.terminal');
    expect(panel).toContain('workspaceSidebar.tool.sideChat');
    expect(panel).toContain('<TerminalPanel />');
    expect(terminal).toContain('data-source-breadcrumb="app-server.process/spawn"');
    expect(terminal).toContain('spawnProcess({');
    expect(terminal).toContain('writeProcessStdin({');
    expect(terminal).toContain('resizeProcessPty({');
    expect(terminal).toContain('env: terminalEnvironment()');
    expect(frame).toContain("brightBlue: '#3b82c4'");
  });
});
