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

  it('终端和侧边聊天占位入口继续保留', () => {
    const tabBar = source('src/components/layout/WorkspaceSidebar/TabBar.tsx');
    const panel = source('src/components/layout/WorkspaceSidebar/TabPanel.tsx');

    expect(tabBar).toContain('workspaceSidebar.tool.terminal');
    expect(tabBar).toContain('workspaceSidebar.tool.sideChat');
    expect(panel).toContain('workspaceSidebar.tool.terminal');
    expect(panel).toContain('workspaceSidebar.tool.sideChat');
  });
});
