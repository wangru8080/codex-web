import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_HOME_TAB_ID,
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

  it('侧边聊天标签不写入持久化状态', () => {
    const state = openDynamicTab(initialState({ open: true }), {
      id: 'side-chat',
      kind: 'side-chat',
      key: 'side-chat',
      title: '侧边聊天',
    });

    expect(serialize(state).dynamicTabs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'side-chat' })]),
    );
  });
});
