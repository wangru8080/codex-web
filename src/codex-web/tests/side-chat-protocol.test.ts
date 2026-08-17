import { describe, expect, it } from 'vitest';

import {
  SIDE_CHAT_BOUNDARY_PROMPT,
  buildSideChatBoundaryItems,
  buildSideChatForkParams,
  prepareSideChat,
} from '@/codex-web/side-chat-protocol';

describe('侧边聊天协议', () => {
  it('以临时线程方式 fork 主会话', () => {
    expect(buildSideChatForkParams('parent-thread')).toMatchObject({
      threadId: 'parent-thread',
      lastTurnId: null,
      ephemeral: true,
      threadSource: 'codex_web',
    });
    expect(buildSideChatForkParams('parent-thread').developerInstructions).toContain(
      'Only instructions submitted after the side-conversation boundary are active',
    );
  });

  it('在现有 developer instructions 后追加侧聊约束', () => {
    const params = buildSideChatForkParams('parent-thread', 'Existing policy.');

    expect(params.developerInstructions).toMatch(/^Existing policy\.\n\nYou are in a side conversation/);
  });

  it('注入仅供模型读取的父子会话边界', () => {
    expect(buildSideChatBoundaryItems()).toEqual([{
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: SIDE_CHAT_BOUNDARY_PROMPT }],
    }]);
    expect(SIDE_CHAT_BOUNDARY_PROMPT).toContain('Everything before this boundary is inherited history');
  });

  it('fork 成功后再注入边界', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const response = { thread: { id: 'side-thread' } };
    const request = async (method: string, params: unknown) => {
      calls.push({ method, params });
      return method === 'thread/fork' ? response : {};
    };

    await expect(prepareSideChat(request, 'parent-thread')).resolves.toBe(response);
    expect(calls.map(({ method }) => method)).toEqual(['thread/fork', 'thread/inject_items']);
    expect(calls[1]?.params).toMatchObject({ threadId: 'side-thread' });
  });

  it('边界注入失败时取消订阅临时线程', async () => {
    const methods: string[] = [];
    const request = async (method: string) => {
      methods.push(method);
      if (method === 'thread/fork') return { thread: { id: 'side-thread' } };
      if (method === 'thread/inject_items') throw new Error('inject failed');
      return {};
    };

    await expect(prepareSideChat(request, 'parent-thread')).rejects.toThrow('inject failed');
    expect(methods).toEqual(['thread/fork', 'thread/inject_items', 'thread/unsubscribe']);
  });
});
