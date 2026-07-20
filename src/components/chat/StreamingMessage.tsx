'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  Message as AIMessage,
  MessageContent,
  StreamingMessageResponse as MessageResponse,
} from '@/components/ai-elements/message';
import { ProcessCollapseGroup, ToolActionsGroup } from '@/components/ai-elements/tool-actions-group';
import { MediaPreview } from './MediaPreview';
import { Button } from '@/components/ui/button';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { ProposedPlanMessageBlock, UpdatedPlanMessageBlock } from './PlanMessageBlock';
import { ContextCompactionRow } from './ContextCompactionRow';
import {
  groupConsecutiveToolBlocks,
  type StreamingProcessBlock,
} from './streaming-process-groups';
import type { MediaBlock, MessageContentBlock } from '@/types';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  media?: MediaBlock[];
}

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
  sessionId?: string;
  startedAt: number;
  toolUses?: ToolUseInfo[];
  toolResults?: ToolResultInfo[];
  streamingToolOutput?: string;
  thinkingContent?: string;
  processBlocks?: MessageContentBlock[];
  planBlocks?: MessageContentBlock[];
  statusText?: string;
  onForceStop?: () => void;
}

/**
 * Smart content buffering — holds initial text until meaningful.
 */
const BUFFER_WORD_THRESHOLD = 40;
const BUFFER_MAX_MS = 2500;

function useBufferedContent(rawContent: string, isStreaming: boolean): string {
  const [bypassed, setBypassed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive whether bypass conditions are met (pure computation, no side effects)
  const shouldBypass = !isStreaming
    || bypassed
    || (!!rawContent && rawContent.split(/\s+/).filter(Boolean).length >= BUFFER_WORD_THRESHOLD);

  // Effect: sync bypass state when conditions are met (one-way latch, safe)
  useEffect(() => {
    if (shouldBypass && !bypassed && isStreaming && rawContent) {
      setBypassed(true); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [shouldBypass, bypassed, isStreaming, rawContent]);

  // Effect: reset on new turn (content emptied)
  useEffect(() => {
    if (!rawContent && !isStreaming) {
      setBypassed(false); // eslint-disable-line react-hooks/set-state-in-effect
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [rawContent, isStreaming]);

  // Effect: max timeout — starts once when content first arrives during streaming.
  // Uses a boolean gate (hasContent) so the timer is created exactly once, not on every delta.
  const hasContent = !!rawContent;
  useEffect(() => {
    if (!isStreaming || bypassed || !hasContent) return;
    // Only start the timer if one isn't already running
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      setBypassed(true);
      timerRef.current = null;
    }, BUFFER_MAX_MS);
    // No cleanup — timer must survive rawContent changes.
    // It is cleaned up by the reset effect (when content empties) or when bypassed is set.
  }, [isStreaming, bypassed, hasContent]);

  // Pure render: no side effects
  if (!isStreaming) return rawContent;
  if (shouldBypass) return rawContent;
  return '';
}

/**
 * Wait-phase label shown while waiting for the first content token.
 * Pure UX-comfort progression — NOT tied to model thinking/reasoning state.
 * Real reasoning content is rendered separately by ToolActionsGroup's ThinkingRow.
 *   0-5s:  "生成中..." / "Generating..."
 *   5-15s: "回复中..." / "Responding..."
 *   15s+:  "组织回复中..." / "Preparing response..."
 * Wording deliberately avoids "thinking" because users read it as the model
 * actually reasoning hard — misleading for short prompts where the model
 * just hasn't streamed first byte yet.
 */
function ThinkingPhaseLabel() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 5000);
    const t2 = setTimeout(() => setPhase(2), 15000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const text = phase === 0
    ? t('streaming.thinking')
    : phase === 1
      ? t('streaming.thinkingDeep')
      : t('streaming.preparing');

  return <Shimmer>{text}</Shimmer>;
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  // Phase 6 P0 follow-up (2026-05-15) — guard against the brief
  // window right after `setIsStreaming(true)` where the parent
  // hasn't yet populated `startedAt` (snapshot can still be 0 /
  // undefined / NaN). Without this gate the JS arithmetic
  // produces `NaN` (undefined minus number) or a huge nonsense
  // number (0 minus Date.now()), and the rendered `${secs}s`
  // template flashes "NaNs" or "1.7e9s" for a tick. The status
  // bar's "Thinking..." shimmer + label still surface — we just
  // hide the elapsed-time counter until the start timestamp is
  // a real positive monotonic value.
  const startedAtIsReady = Number.isFinite(startedAt) && startedAt > 0;
  const [elapsed, setElapsed] = useState(() =>
    startedAtIsReady ? Math.floor((Date.now() - startedAt) / 1000) : 0,
  );

  // The parent keys this component by `startedAt` (see render site), so a new
  // turn / session switch remounts it and the lazy initializer above repaints
  // the correct first value synchronously — no stale tick. This effect then
  // only ticks every second; setState runs in the interval callback (async),
  // never in the effect body, so there's no set-state-in-effect cascade.
  // (#35 on-touch — previously a same-render reset effect that the React
  // Compiler flagged; key-based remount is the clean equivalent.)
  useEffect(() => {
    if (!startedAtIsReady) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt, startedAtIsReady]);

  if (!startedAtIsReady) return null;

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <span className="tabular-nums">
      {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
    </span>
  );
}

function StreamingStatusBar({ statusText, onForceStop, startedAt }: { statusText?: string; onForceStop?: () => void; startedAt: number }) {
  const displayText = statusText || 'Thinking';

  // Parse elapsed seconds from statusText like "Running bash... (45s)"
  const elapsedMatch = statusText?.match(/\((\d+)s\)/);
  const toolElapsed = elapsedMatch ? parseInt(elapsedMatch[1], 10) : 0;
  const isWarning = toolElapsed >= 60;
  const isCritical = toolElapsed >= 90;

  return (
    <div className="flex items-center gap-3 py-2 px-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className={isCritical ? 'text-status-error-foreground' : isWarning ? 'text-status-warning-foreground' : undefined}>
          <Shimmer duration={1.5}>{displayText}</Shimmer>
        </span>
        {isWarning && !isCritical && (
          <span className="text-status-warning-foreground text-[10px]">Running longer than usual</span>
        )}
        {isCritical && (
          <span className="text-status-error-foreground text-[10px]">Tool may be stuck</span>
        )}
      </div>
      <span className="text-muted-foreground/50">|</span>
      <ElapsedTimer key={startedAt} startedAt={startedAt} />
      {isCritical && onForceStop && (
        <Button
          variant="outline"
          size="xs"
          onClick={onForceStop}
          className="ml-auto border-status-error-border bg-status-error-muted text-[10px] font-medium text-status-error-foreground hover:bg-status-error-muted"
        >
          Force stop
        </Button>
      )}
    </div>
  );
}

export function StreamingMessage({
  content,
  isStreaming,
  sessionId,
  startedAt,
  toolUses = [],
  toolResults = [],
  streamingToolOutput,
  thinkingContent,
  processBlocks = [],
  planBlocks = [],
  statusText,
  onForceStop,
}: StreamingMessageProps) {
  const { t } = useTranslation();
  const bufferedContent = useBufferedContent(content, isStreaming);
  // A2 (audit 2026-06): index toolResults by id once, then reuse for both the
  // running-tools filter and the per-tool lookup in the render below. Both
  // previously did an O(n) scan inside an O(n) loop → O(n²) every render.
  const toolResultsById = useMemo(
    () => new Map(toolResults.map((r) => [r.tool_use_id, r] as const)),
    [toolResults]
  );
  const runningTools = useMemo(
    () => toolUses.filter((tool) => !toolResultsById.has(tool.id)),
    [toolUses, toolResultsById]
  );
  const finalStarted = content.trim().length > 0;
  const toolItems = useMemo(
    () => toolUses.map((tool) => {
      const result = toolResultsById.get(tool.id);
      return {
        id: tool.id,
        name: tool.name,
        input: tool.input,
        result: result?.content,
        isError: result?.is_error,
        media: result?.media,
      };
    }),
    [toolUses, toolResultsById]
  );
  const orderedProcessBlocks = useMemo(
    () => processBlocks.filter((block): block is StreamingProcessBlock =>
      block.type === 'thinking' ||
      block.type === 'codex_process_text' ||
      block.type === 'codex_context_compaction' ||
      block.type === 'tool_use',
    ),
    [processBlocks],
  );
  const processSegments = useMemo(
    () => groupConsecutiveToolBlocks(orderedProcessBlocks),
    [orderedProcessBlocks],
  );
  const processToolResultsById = useMemo(
    () => new Map(
      processBlocks
        .filter((block): block is Extract<MessageContentBlock, { type: 'tool_result' }> => block.type === 'tool_result')
        .map((block) => [block.tool_use_id, block] as const),
    ),
    [processBlocks],
  );
  const hasOrderedProcess = orderedProcessBlocks.length > 0;
  const hasProcessActivity = hasOrderedProcess || toolItems.length > 0 || !!thinkingContent;

  // Extract a human-readable summary of the running command
  const getRunningCommandSummary = (): string | undefined => {
    if (runningTools.length === 0) {
      // All tools completed but still streaming — AI is generating text
      if (toolUses.length > 0) return 'Generating response...';
      return undefined;
    }
    const tool = runningTools[runningTools.length - 1];
    const input = tool.input as Record<string, unknown>;
    if (tool.name === 'Bash' && input.command) {
      const cmd = String(input.command);
      return cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
    }
    if (input.file_path) return `${tool.name}: ${String(input.file_path)}`;
    if (input.path) return `${tool.name}: ${String(input.path)}`;
    return `Running ${tool.name}...`;
  };

  return (
    <AIMessage from="assistant">
      <MessageContent>
        {/* 整轮过程在 final 开始后折叠，连续工具在内部按组折叠。 */}
        {hasProcessActivity && (
          <ProcessCollapseGroup
            defaultExpanded={!finalStarted}
            active={!finalStarted && isStreaming}
            summary={(
              <span className="inline-flex items-center gap-1">
                <span>已处理</span>
                <ElapsedTimer key={startedAt} startedAt={startedAt} />
              </span>
            )}
          >
          <div className="w-full space-y-1">
            {hasOrderedProcess ? processSegments.map((segment, index) => {
              if (segment.type === 'tools') {
                const tools = segment.blocks.map((block) => {
                  const result = processToolResultsById.get(block.id);
                  return {
                    id: block.id,
                    name: block.name,
                    input: block.input,
                    result: result?.content,
                    isError: result?.is_error,
                    media: result?.media,
                  };
                });
                const hasRunningTool = tools.some((tool) => tool.result === undefined);
                return (
                  <ToolActionsGroup
                    key={`process-tools-${segment.blocks[0]?.id ?? index}-${hasRunningTool ? 'running' : 'complete'}`}
                    tools={tools}
                    isStreaming={hasRunningTool}
                    streamingToolOutput={hasRunningTool ? streamingToolOutput : undefined}
                    defaultExpanded={hasRunningTool}
                  />
                );
              }
              const block = segment.block;
              if (block.type === 'thinking') {
                return (
                  <ToolActionsGroup
                    key={`process-thinking-${index}`}
                    tools={[]}
                    isStreaming={!finalStarted && isStreaming}
                    thinkingContent={block.thinking}
                    defaultExpanded={!finalStarted}
                  />
                );
              }
              if (block.type === 'codex_process_text') {
                return (
                  <div key={`process-text-${index}`} className="px-2 py-2 text-sm leading-7">
                    <MessageResponse>{block.text}</MessageResponse>
                  </div>
                );
              }
              if (block.type === 'codex_context_compaction') {
                return <ContextCompactionRow key={`context-compaction-${index}`} block={block} />;
              }
              return null;
            }) : <>
            {thinkingContent && (
              <ToolActionsGroup
                tools={[]}
                isStreaming={!finalStarted && isStreaming}
                thinkingContent={thinkingContent}
                defaultExpanded={!finalStarted}
              />
            )}
            {toolItems.length > 0 && (() => {
              const hasRunningTool = toolItems.some((tool) => tool.result === undefined);
              return (
                <ToolActionsGroup
                  key={`legacy-tools-${hasRunningTool ? 'running' : 'complete'}`}
                  tools={toolItems}
                  isStreaming={hasRunningTool}
                  streamingToolOutput={hasRunningTool ? streamingToolOutput : undefined}
                  defaultExpanded={hasRunningTool}
                />
              );
            })()}
            </>}
          </div>
          </ProcessCollapseGroup>
        )}

        {/* Media from tool results — rendered outside tool group so images stay visible */}
        {(() => {
          const allMedia = toolResults.flatMap(r => r.media || []);
          return allMedia.length > 0 ? <MediaPreview media={allMedia} /> : null;
        })()}

        {planBlocks.map((block, index) => {
          if (block.type === 'codex_proposed_plan') {
            return <ProposedPlanMessageBlock key={`stream-proposed-plan-${index}`} block={block} />;
          }
          if (block.type === 'codex_updated_plan') {
            return <UpdatedPlanMessageBlock key={`stream-updated-plan-${index}`} block={block} />;
          }
          return null;
        })}

        {/* Streaming text content rendered via Streamdown */}
        {content && (
          <div
            className="contents"
            data-assistant-final-answer
            data-answer-complete={isStreaming ? "false" : "true"}
          >
            {(isStreaming ? bufferedContent : content) && (
              <MessageResponse>{isStreaming ? bufferedContent : content}</MessageResponse>
            )}
          </div>
        )}

        {/* Loading indicator when no content yet and no thinking content — evolves over time */}
        {isStreaming && !content && toolUses.length === 0 && !thinkingContent && (
          <div className="py-2">
            <ThinkingPhaseLabel />
          </div>
        )}

        {/* Status bar during streaming — priority: tool status > generating > waiting */}
        {isStreaming && !hasProcessActivity && statusText !== '已处理' && <StreamingStatusBar statusText={
          statusText
          || getRunningCommandSummary()
          || (content && content.length > 0 ? t('streaming.generating') : undefined)
        } onForceStop={onForceStop} startedAt={startedAt} />}
      </MessageContent>
    </AIMessage>
  );
}
