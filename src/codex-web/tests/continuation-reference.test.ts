import { describe, expect, it } from 'vitest';

import {
  completeContinuationFork,
  continuationParentHref,
  continuationReferenceStorageKey,
  needsContinuationTargetHistory,
  parseContinuationReference,
} from '../continuation-reference';

describe('接续任务导航引用', () => {
  it('按子任务保存并恢复父任务输出点', () => {
    expect(continuationReferenceStorageKey('child-1')).toBe(
      'codex-web:continuation-reference:child-1',
    );
    expect(parseContinuationReference(JSON.stringify({
      parentThreadId: 'parent-1',
      parentMessageId: 'agent-3',
      lastTurnId: 'turn-3',
    }))).toEqual({
      parentThreadId: 'parent-1',
      parentMessageId: 'agent-3',
      lastTurnId: 'turn-3',
    });
  });

  it('忽略损坏或不完整的引用', () => {
    expect(parseContinuationReference(null)).toBeNull();
    expect(parseContinuationReference('{')).toBeNull();
    expect(parseContinuationReference('{"parentThreadId":"parent-1"}')).toBeNull();
  });

  it('父任务链接同时携带加载参数和浏览器锚点', () => {
    expect(continuationParentHref('parent/1', 'agent 3')).toBe(
      '/chat/parent%2F1?continuationMessage=agent+3#msg-agent%203',
    );
  });

  it('仅在目标不在首屏消息中时读取完整历史', () => {
    expect(needsContinuationTargetHistory(['agent-2', 'agent-3'], 'agent-3')).toBe(false);
    expect(needsContinuationTargetHistory(['agent-2', 'agent-3'], 'agent-1')).toBe(true);
    expect(needsContinuationTargetHistory(['agent-2'], undefined)).toBe(false);
  });

  it('重命名失败仍保存引用并进入已创建的任务', async () => {
    const calls: string[] = [];

    await completeContinuationFork({
      rename: async () => { throw new Error('rename failed'); },
      saveReference: () => { calls.push('save'); },
      navigate: () => { calls.push('navigate'); },
      onPostProcessError: () => { calls.push('error'); },
    });

    expect(calls).toEqual(['error', 'save', 'navigate']);
  });

  it('本地引用保存失败仍进入已创建的任务', async () => {
    const calls: string[] = [];

    await completeContinuationFork({
      rename: async () => { calls.push('rename'); },
      saveReference: () => { throw new Error('storage failed'); },
      navigate: () => { calls.push('navigate'); },
      onPostProcessError: () => { calls.push('error'); },
    });

    expect(calls).toEqual(['rename', 'error', 'navigate']);
  });
});
