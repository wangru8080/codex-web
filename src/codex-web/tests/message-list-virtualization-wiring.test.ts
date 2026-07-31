import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('聊天虚拟化与流式渲染接线', () => {
  it('消息列表使用动态高度虚拟化和稳定消息 key', () => {
    const source = read('src/components/chat/MessageList.tsx');
    expect(source).toContain("from 'react-virtuoso'");
    expect(source).toContain('firstItemIndex={firstItemIndex}');
    expect(source).toContain('initialTopMostItemIndex={initialTopMostItemIndex}');
    expect(source).toContain('? row.message.id');
    expect(source).toContain('? `continued-from:${row.href}`');
    expect(source).toContain(": 'streaming-message'");
    expect(source).toContain('followOutput');
    expect(source).toContain('atBottomStateChange={handleAtBottomStateChange}');
    expect(source).toContain('totalListHeightChanged={handleTotalListHeightChanged}');
    expect(source).toContain('scrollerRef={handleScrollerRef}');
    expect(source).toContain('handleInitialBottomLockUserInteraction');
    expect(source).toContain('!nextIsAtBottom && initialBottomLockRef.current');
    expect(source).toContain('useLayoutEffect(() => {');
    expect(source).toContain('scroller.scrollTop = scroller.scrollHeight');
    expect(source).toContain("next.addEventListener('scroll', handleInitialBottomLockScroll");
    expect(source).not.toContain('height <= scroller.clientHeight) {');
    expect(source).toContain('data-virtualized-message-list');
    expect(source).not.toMatch(/^\s*alignToBottom\s*$/m);
    expect(source).not.toContain('{messages.map((message) =>');
  });

  it('历史前插使用单调虚拟索引而不是 DOM scrollIntoView', () => {
    const source = read('src/components/chat/MessageList.tsx');
    expect(source).toContain('nextVirtualFirstItemIndex');
    expect(source).not.toContain('scrollIntoView({ block:');
  });

  it('接续深链禁用底部锁定并使用 Virtuoso 定位目标消息', () => {
    const messageList = read('src/components/chat/MessageList.tsx');
    const chatView = read('src/components/chat/ChatView.tsx');
    const page = read('src/app/chat/[id]/page.tsx');

    expect(messageList).toContain('targetMessageVirtualIndex');
    expect(messageList).toContain("{ index: targetVirtualIndex, align: 'center' as const }");
    expect(messageList).toContain('if (targetMessageId) return;');
    expect(chatView).toContain('targetMessageId={targetMessageId}');
    expect(page).toContain("searchParams.get('continuationMessage')");
    expect(page).toContain("readThread(id, { includeTurns: true })");
    expect(page).toContain('needsContinuationTargetHistory');
  });

  it('展示快照按帧合并，terminal effect 继续读取原始 Turn', () => {
    const chatView = read('src/components/chat/ChatView.tsx');
    expect(chatView).toContain('const presentedAppServerTurn = useAnimationFrameValue(appServerTurn)');
    expect(chatView).toContain('deriveCodexWebToolState(presentedAppServerTurn ?? null)');
    expect(chatView).toContain("if (!['completed', 'failed', 'interrupted'].includes(appServerTurn.status)) return");
  });

  it('输入区和流式消息使用 memo 边界', () => {
    expect(read('src/components/chat/MessageInput.tsx')).toContain(
      'export const MessageInput = memo(function MessageInput',
    );
    expect(read('src/components/chat/StreamingMessage.tsx')).toContain(
      'export const StreamingMessage = memo(function StreamingMessage',
    );
  });
});
