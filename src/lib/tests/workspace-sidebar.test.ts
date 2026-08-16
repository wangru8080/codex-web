import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_HOME_TAB_ID,
  initialState,
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
});
