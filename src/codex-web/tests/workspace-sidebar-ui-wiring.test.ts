import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('工作区侧栏 UI 接线', () => {
  it('打开文件后关闭加号菜单', () => {
    const tabBar = source('src/components/layout/WorkspaceSidebar/TabBar.tsx');
    const appShell = source('src/components/layout/AppShell.tsx');

    expect(tabBar).toContain('open={toolMenuOpen}');
    expect(tabBar).toContain('setToolMenuOpen(false)');
    expect(appShell).toContain('<Sheet open modal={false} onOpenChange={ws.setOpen}>');
  });

  it('路径目录点击定位现有文件树', () => {
    const panel = source('src/components/layout/WorkspaceSidebar/TabPanel.tsx');
    const treePanel = source('src/components/layout/panels/FileTreePanel.tsx');

    expect(panel).toContain('setTreeFocus({ path: item.path');
    expect(panel).toContain('focusPath={treeFocus?.path}');
    expect(treePanel).toContain('highlightPath={focusPath ?? highlightPath}');
  });

  it('终端和侧边聊天入口都接入真实 app-server', () => {
    const tabBar = source('src/components/layout/WorkspaceSidebar/TabBar.tsx');
    const panel = source('src/components/layout/WorkspaceSidebar/TabPanel.tsx');
    const terminal = source('src/components/layout/WorkspaceSidebar/TerminalPanel.tsx');
    const frame = source('src/components/layout/WorkspaceSidebar/TerminalFrame.tsx');
    const sideChat = source('src/components/layout/WorkspaceSidebar/SideChatPanel.tsx');
    const provider = source('src/codex-web/AppServerProvider.tsx');

    expect(tabBar).toContain('workspaceSidebar.tool.terminal');
    expect(tabBar).toContain('workspaceSidebar.tool.sideChat');
    expect(tabBar).toContain("kind: 'terminal-pinned'");
    expect(panel).toContain('workspaceSidebar.tool.terminal');
    expect(panel).toContain('workspaceSidebar.tool.sideChat');
    expect(panel).toContain('<TerminalPanel />');
    expect(panel).toContain('<SideChatPanel />');
    expect(tabBar).toContain('openSideChat(');
    expect(tabBar).not.toContain('label={t(\'workspaceSidebar.tool.sideChat\' as TranslationKey)} disabled');
    expect(sideChat).toContain('<ChatView');
    expect(sideChat).toContain('appServerThreadId={childThreadId}');
    expect(sideChat).toContain('emptyState={<SideChatEmptyState />}');
    expect(provider).toContain('prepareSideChat(');
    expect(provider).toContain('client.request("thread/unsubscribe"');
    expect(terminal).toContain('data-source-breadcrumb="app-server.process/spawn"');
    expect(terminal).toContain('spawnProcess({');
    expect(terminal).toContain('writeProcessStdin({');
    expect(terminal).toContain('resizeProcessPty({');
    expect(terminal).toContain('env: terminalEnvironment()');
    expect(frame).toContain("brightBlue: '#3b82c4'");
  });

  it('关闭侧聊使用确认弹窗，且不调用 thread/delete', () => {
    const tabBar = source('src/components/layout/WorkspaceSidebar/TabBar.tsx');
    const sidebarHook = source('src/hooks/useWorkspaceSidebar.tsx');

    expect(tabBar).toContain('workspaceSidebar.sideChat.closeTitle');
    expect(tabBar).toContain('workspaceSidebar.sideChat.doNotAskAgain');
    expect(tabBar).toContain('await closeSideChat()');
    expect(sidebarHook).toContain('await interruptTurn({ threadId: current.threadId })');
    expect(sidebarHook).toContain('await unsubscribeThread(current.threadId)');
    expect(sidebarHook).not.toContain('deleteThread');
  });
});
