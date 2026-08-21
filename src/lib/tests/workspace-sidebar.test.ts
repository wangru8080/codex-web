import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_HOME_TAB_ID,
  closeTab,
  createSideChatTab,
  initialState,
  openDynamicTab,
  parse,
  serialize,
} from '@/lib/workspace-sidebar';

describe('工作区侧栏状态', () => {
  it('保留总览活动状态', () => {
    const state = { ...initialState({ open: true }), activeTabId: WORKSPACE_HOME_TAB_ID };

    expect(parse(JSON.stringify(serialize(state))).activeTabId).toBe(WORKSPACE_HOME_TAB_ID);
  });

  it('未知活动状态回退到 Git', () => {
    const persisted = serialize(initialState({ open: true }));

    expect(parse(JSON.stringify({ ...persisted, activeTabId: 'missing' })).activeTabId).toBe('git');
  });

  it('终端标签可持久化并恢复为活动标签', () => {
    const state = openDynamicTab(initialState({ open: true }), {
      id: 'terminal-pinned',
      kind: 'terminal-pinned',
      key: 'terminal',
      title: '终端',
    });

    expect(parse(JSON.stringify(serialize(state)))).toMatchObject({
      activeTabId: 'terminal-pinned',
      tabs: expect.arrayContaining([expect.objectContaining({ kind: 'terminal-pinned' })]),
    });
  });

  it('多个侧边聊天标签可共存且都不写入持久化状态', () => {
    const first = createSideChatTab('侧边聊天', 1);
    const second = createSideChatTab('侧边聊天', 2);
    const third = createSideChatTab('侧边聊天', 3);
    const state = [first, second, third].reduce(openDynamicTab, initialState({ open: true }));

    expect(state.tabs.filter((tab) => tab.kind === 'side-chat')).toEqual([
      expect.objectContaining({ id: 'side-chat:1', title: '侧边聊天' }),
      expect.objectContaining({ id: 'side-chat:2', title: '侧边聊天 2' }),
      expect.objectContaining({ id: 'side-chat:3', title: '侧边聊天 3' }),
    ]);

    expect(closeTab(state, second.id).tabs.filter((tab) => tab.kind === 'side-chat')).toEqual([
      expect.objectContaining({ id: first.id }),
      expect.objectContaining({ id: third.id }),
    ]);

    expect(serialize(state).dynamicTabs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'side-chat' })]),
    );
  });
});
