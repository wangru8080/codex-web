'use client';

import { forwardRef, useRef, useEffect, useState, useCallback, useMemo, type ComponentPropsWithoutRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { Virtuoso, type Components, type VirtuosoHandle } from 'react-virtuoso';
import { ArrowDown } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import type { FileAttachment, Message, MessageContentBlock } from '@/types';
import type { AppServerRetryStatus } from '@/codex-web/turn-reducer';
import { ConversationEmptyState } from '@/components/ai-elements/conversation';
import { MessageItem } from './MessageItem';
import { StreamingMessage } from './StreamingMessage';
import { PerformanceProfiler } from '@/components/performance/PerformanceProfiler';
import { MonolithIcon } from '@/components/brand/MonolithIcon';
import { SPECIES_IMAGE_URL, EGG_IMAGE_URL, RARITY_BG_GRADIENT, type Species, type Rarity } from '@/lib/buddy';
import {
  INITIAL_VIRTUAL_FIRST_ITEM_INDEX,
  classifyMessageWindowChange,
  nextVirtualFirstItemIndex,
} from './message-list-virtualization';

/**
 * Rewind button shown on user messages that have file checkpoints.
 */
function RewindButton({ sessionId, userMessageId }: { sessionId: string; userMessageId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'preview' | 'loading' | 'done'>('idle');
  const [preview, setPreview] = useState<{ filesChanged?: string[]; insertions?: number; deletions?: number } | null>(null);

  const handleDryRun = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/chat/rewind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userMessageId, dryRun: true }),
      });
      const data = await res.json();
      if (data.canRewind) {
        setPreview(data);
        setState('preview');
      } else {
        setState('idle');
      }
    } catch {
      setState('idle');
    }
  }, [sessionId, userMessageId]);

  const handleRewind = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/chat/rewind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, userMessageId }),
      });
      const data = await res.json();
      if (data.canRewind !== false) {
        setState('done');
        setTimeout(() => setState('idle'), 3000);
      } else {
        setState('idle');
      }
    } catch {
      setState('idle');
    }
  }, [sessionId, userMessageId]);

  if (state === 'done') {
    return (
      <span className="text-[10px] text-status-success-foreground ml-2">
        {t('messageList.rewindDone' as TranslationKey)}
      </span>
    );
  }

  if (state === 'preview' && preview) {
    return (
      <span className="inline-flex items-center gap-1.5 ml-2">
        <span className="text-[10px] text-muted-foreground">
          {preview.filesChanged?.length || 0} files, +{preview.insertions || 0}/-{preview.deletions || 0}
        </span>
        <Button
          variant="link"
          size="xs"
          onClick={handleRewind}
          className="text-[10px] text-primary h-auto p-0"
        >
          {t('messageList.rewindConfirm' as TranslationKey)}
        </Button>
        <Button
          variant="link"
          size="xs"
          onClick={() => setState('idle')}
          className="text-[10px] text-muted-foreground h-auto p-0"
        >
          {t('messageList.rewindCancel' as TranslationKey)}
        </Button>
      </span>
    );
  }

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={handleDryRun}
      disabled={state === 'loading'}
      className="text-[10px] text-muted-foreground hover:text-foreground ml-2 opacity-0 group-hover:opacity-100 h-auto p-0"
    >
      {state === 'loading' ? '...' : t('messageList.rewindToHere' as TranslationKey)}
    </Button>
  );
}

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/** Rewind points contain SDK UUIDs (not local message IDs) */
interface RewindPoint {
  userMessageId: string; // SDK UUID
}

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
  isStreaming: boolean;
  showStreamingMessage?: boolean;
  toolUses?: ToolUseInfo[];
  toolResults?: ToolResultInfo[];
  streamingToolOutput?: string;
  streamingThinkingContent?: string;
  processBlocks?: MessageContentBlock[];
  planBlocks?: MessageContentBlock[];
  statusText?: string;
  retryStatus?: AppServerRetryStatus | null;
  onForceStop?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** SDK rewind points — only emitted for visible prompt-level user messages (not tool results or auto-triggers), mapped by position */
  rewindPoints?: RewindPoint[];
  sessionId?: string;
  startedAt?: number;
  /** Whether this is an assistant workspace project */
  isAssistantProject?: boolean;
  /** Assistant name for avatar display */
  assistantName?: string;
  editableUserMessageId?: string | null;
  onEditUserMessage?: (content: string, files: FileAttachment[]) => Promise<boolean>;
}

type MessageListRow =
  | { type: 'message'; message: Message; rewindSdkUuid?: string }
  | { type: 'streaming' };

type MessageListContext = {
  hasMore: boolean;
  loadingMore: boolean;
  loadEarlierLabel: string;
  loadingLabel: string;
  onLoadMore: () => void;
};

const VirtualListHeader = ({ context }: { context: MessageListContext }) => context.hasMore ? (
  <div className="flex justify-center pb-4 pt-1">
    <Button
      variant="ghost"
      size="sm"
      onClick={context.onLoadMore}
      disabled={context.loadingMore}
      className="text-muted-foreground hover:text-foreground"
    >
      {context.loadingMore ? context.loadingLabel : context.loadEarlierLabel}
    </Button>
  </div>
) : null;

const VirtualListScroller = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<'div'> & { context: MessageListContext }
>(function VirtualListScroller({ context: _context, ...props }, ref) {
  return <div {...props} ref={ref} data-message-list-scroller />;
});

const VirtualListItems = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<'div'> & { context: MessageListContext }
>(function VirtualListItems({ context: _context, className, ...props }, ref) {
  return (
    <div
      {...props}
      ref={ref}
      className={`mx-auto w-full max-w-3xl px-4 py-6 ${className ?? ''}`}
    />
  );
});

const VIRTUAL_LIST_COMPONENTS: Components<MessageListRow, MessageListContext> = {
  Header: VirtualListHeader,
  Scroller: VirtualListScroller,
  List: VirtualListItems,
};

function useVirtualFirstItemIndex(messages: Message[]): number {
  const [tracked, setTracked] = useState(() => ({
    messages,
    ids: messages.map((message) => message.id),
    firstItemIndex: INITIAL_VIRTUAL_FIRST_ITEM_INDEX,
  }));

  if (tracked.messages === messages) return tracked.firstItemIndex;

  const nextIds = messages.map((message) => message.id);
  const change = classifyMessageWindowChange(tracked.ids, nextIds);
  const firstItemIndex = change.type === 'replace'
    ? INITIAL_VIRTUAL_FIRST_ITEM_INDEX
    : nextVirtualFirstItemIndex(tracked.firstItemIndex, change);
  setTracked({ messages, ids: nextIds, firstItemIndex });
  return firstItemIndex;
}

export function MessageList({
  messages,
  streamingContent,
  isStreaming,
  showStreamingMessage = isStreaming,
  toolUses = [],
  toolResults = [],
  streamingToolOutput,
  streamingThinkingContent,
  processBlocks,
  planBlocks,
  statusText,
  retryStatus,
  onForceStop,
  hasMore,
  loadingMore,
  onLoadMore,
  rewindPoints = [],
  sessionId,
  startedAt,
  isAssistantProject,
  assistantName,
  editableUserMessageId,
  onEditUserMessage,
}: MessageListProps) {
  const { t } = useTranslation();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const firstItemIndex = useVirtualFirstItemIndex(messages);
  const handleLoadMore = useCallback(() => onLoadMore?.(), [onLoadMore]);

  const rows = useMemo<MessageListRow[]>(() => {
    let userIndex = 0;
    const messageRows = messages.map<MessageListRow>((message) => {
      let rewindSdkUuid: string | undefined;
      if (message.role === 'user') {
        if (sessionId && userIndex < rewindPoints.length) {
          rewindSdkUuid = rewindPoints[userIndex]?.userMessageId;
        }
        userIndex += 1;
      }
      return { type: 'message', message, rewindSdkUuid };
    });
    return showStreamingMessage ? [...messageRows, { type: 'streaming' }] : messageRows;
  }, [messages, rewindPoints, sessionId, showStreamingMessage]);

  const listContext = useMemo<MessageListContext>(() => ({
    hasMore: !!hasMore,
    loadingMore: !!loadingMore,
    loadEarlierLabel: t('messageList.loadEarlier'),
    loadingLabel: t('messageList.loading'),
    onLoadMore: handleLoadMore,
  }), [handleLoadMore, hasMore, loadingMore, t]);

  const handleAtBottomStateChange = useCallback((nextIsAtBottom: boolean) => {
    isAtBottomRef.current = nextIsAtBottom;
    setIsAtBottom(nextIsAtBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!showStreamingMessage || !isAtBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => virtuosoRef.current?.autoscrollToBottom());
    return () => window.cancelAnimationFrame(frame);
  }, [processBlocks, showStreamingMessage, streamingContent, streamingThinkingContent, streamingToolOutput, toolResults, toolUses]);

  if (messages.length === 0 && !isStreaming) {
    if (isAssistantProject) {
      // Assistant workspace — show buddy or egg welcome
      const buddyInfo = typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>).__codepilot_buddy_info__ as { species?: string; rarity?: string } | undefined
        : undefined;
      const hasBuddy = !!buddyInfo?.species;
      return (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            {hasBuddy ? (
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center"
                style={{ background: RARITY_BG_GRADIENT[buddyInfo!.rarity as Rarity] || '' }}
              >
                <img
                  src={SPECIES_IMAGE_URL[buddyInfo!.species as Species] || ''}
                  alt="" width={64} height={64} className="drop-shadow-md"
                />
              </div>
            ) : (
              <img src={EGG_IMAGE_URL} alt="" width={64} height={64} className="drop-shadow-md" />
            )}
            <div className="space-y-1">
              <h3 className="font-medium text-sm">
                {hasBuddy
                  ? (assistantName || t('messageList.claudeChat'))
                  : t('buddy.adoptPrompt' as TranslationKey)}
              </h3>
              <p className="text-muted-foreground text-sm">
                {hasBuddy
                  ? t('messageList.emptyDescription')
                  : t('buddy.adoptDescription' as TranslationKey)}
              </p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center">
        <ConversationEmptyState
          title={t('messageList.claudeChat')}
          description={t('messageList.emptyDescription')}
          icon={<MonolithIcon className="h-16 w-16" />}
        />
      </div>
    );
  }

  return (
    <div
      className="relative min-h-0 flex-1"
      data-virtualized-message-list
      data-message-count={messages.length}
    >
      <Virtuoso<MessageListRow, MessageListContext>
        ref={virtuosoRef}
        className="h-full"
        data={rows}
        context={listContext}
        components={VIRTUAL_LIST_COMPONENTS}
        computeItemKey={(_index, row) => row.type === 'message' ? row.message.id : 'streaming-message'}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
        alignToBottom
        followOutput
        atBottomThreshold={48}
        atBottomStateChange={handleAtBottomStateChange}
        increaseViewportBy={{ top: 600, bottom: 800 }}
        minOverscanItemCount={{ top: 2, bottom: 2 }}
        itemContent={(_index, row) => row.type === 'message' ? (
          <div id={`msg-${row.message.id}`} className="group pb-6" data-message-row>
              <PerformanceProfiler id="MessageItem">
                <MessageItem
                  message={row.message}
                  sessionId={sessionId}
                  canEdit={row.message.id === editableUserMessageId}
                  onEdit={row.message.id === editableUserMessageId ? onEditUserMessage : undefined}
                  isAssistantProject={isAssistantProject}
                  assistantName={assistantName}
                />
              </PerformanceProfiler>
              {row.rewindSdkUuid && sessionId && !isStreaming && (
                <RewindButton sessionId={sessionId} userMessageId={row.rewindSdkUuid} />
              )}
            </div>
        ) : (
          <div className="pb-6" data-streaming-message-row>
          <PerformanceProfiler id="StreamingMessage">
            <StreamingMessage
              content={streamingContent}
              isStreaming={isStreaming}
              sessionId={sessionId}
              startedAt={startedAt ?? 0}
              toolUses={toolUses}
              toolResults={toolResults}
              streamingToolOutput={streamingToolOutput}
              thinkingContent={streamingThinkingContent}
              processBlocks={processBlocks}
              planBlocks={planBlocks}
              statusText={statusText}
              retryStatus={retryStatus}
              onForceStop={onForceStop}
            />
          </PerformanceProfiler>
          </div>
        )}
      />
      {!isAtBottom && (
        <Button
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full dark:bg-background dark:hover:bg-muted"
          onClick={scrollToBottom}
          size="icon"
          type="button"
          variant="outline"
          aria-label="滚动到底部"
        >
          <ArrowDown className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
