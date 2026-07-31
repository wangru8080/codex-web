'use client';

import { Fragment, useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { Message, TokenUsage, FileAttachment, MediaBlock, MessageContentBlock } from '@/types';
import {
  Message as AIMessage,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { ProcessCollapseGroup, ToolActionsGroup } from '@/components/ai-elements/tool-actions-group';
import { MediaPreview } from './MediaPreview';
import { DiffSummary } from './DiffSummary';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Check, CaretDown, CaretUp, CaretRight, NotePencil, Copy, ArrowsSplit, SpinnerGap } from "@/components/ui/icon";
import { FileAttachmentDisplay } from './FileAttachmentDisplay';
import { FileExcerptDisplay } from './FileExcerptDisplay';
import { parseFileExcerptDisplay } from '@/lib/file-excerpt-reference';
import { ProposedPlanMessageBlock } from './PlanMessageBlock';
import { ContextCompactionRow } from './ContextCompactionRow';
// SPECIES_IMAGE_URL / EGG_IMAGE_URL / RARITY_BG_GRADIENT were used by
// the assistant-chat avatar (removed 2026-05-21); the imports are kept
// out to avoid stale references.
import { parseDBDate } from '@/lib/utils';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { classifyPath } from '@/lib/preview-source';
import { isWriteTool, isCreateTool, extractWritePath, resolveToolPath } from '@/lib/file-write-tools';
import { DevOutputSegment } from './DevOutputChips';
import { showToast } from '@/hooks/useToast';
import { writeTextToClipboard } from '@/lib/clipboard';

interface MessageItemProps {
  message: Message;
  sessionId?: string;
  canEdit?: boolean;
  onEdit?: (content: string, files: FileAttachment[]) => Promise<boolean>;
  onContinueInNewTask?: (lastTurnId?: string, sourceMessageId?: string) => Promise<void>;
  /** Whether this is an assistant workspace project */
  isAssistantProject?: boolean;
  /** Assistant name for avatar */
  assistantName?: string;
}

interface ToolBlock {
  type: 'tool_use' | 'tool_result';
  id?: string;
  name?: string;
  input?: unknown;
  content?: string;
  is_error?: boolean;
  media?: MediaBlock[];
}

interface PairedTool {
  name: string;
  input: unknown;
  result?: string;
  isError?: boolean;
  media?: MediaBlock[];
}

type AssistantRenderPart =
  | { type: 'text'; text: string; variant: 'process' | 'final' }
  | { type: 'tools'; tools: ToolBlock[] }
  | Extract<MessageContentBlock, { type: 'codex_context_compaction' }>
  | { type: 'proposed_plan'; text: string; sourceBreadcrumb: string };

function parseToolBlocks(content: string): {
  text: string;
  tools: ToolBlock[];
  renderParts: AssistantRenderPart[];
  thinking?: string;
  elapsedMs?: number;
  processCount?: number;
} {
  const tools: ToolBlock[] = [];
  const renderParts: AssistantRenderPart[] = [];
  let text = '';
  let thinking: string | undefined;
  let elapsedMs: number | undefined;
  let processCount: number | undefined;

  const visibleTextParts: string[] = [];
  let pendingTools: ToolBlock[] = [];
  const pushTextPart = (value: string, variant: 'process' | 'final') => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (pendingTools.length > 0) {
      renderParts.push({ type: 'tools', tools: pendingTools });
      pendingTools = [];
    }
    renderParts.push({ type: 'text', text: trimmed, variant });
    visibleTextParts.push(trimmed);
  };
  const pushToolPart = (tool: ToolBlock) => {
    tools.push(tool);
    pendingTools.push(tool);
  };
  const flushPendingTools = () => {
    if (pendingTools.length === 0) return;
    renderParts.push({ type: 'tools', tools: pendingTools });
    pendingTools = [];
  };

  // Try to parse as JSON array (new format from chat API)
  if (content.startsWith('[')) {
    try {
      const blocks = JSON.parse(content) as Array<{
        type: string;
        text?: string;
        thinking?: string;
        id?: string;
        name?: string;
        input?: unknown;
        tool_use_id?: string;
        content?: string;
        is_error?: boolean;
        elapsed_ms?: number;
        process_count?: number;
        media?: MediaBlock[];
        sourceBreadcrumb?: string;
        explanation?: string | null;
        steps?: Array<{ step?: string; status?: string }>;
        progress?: { completed?: number; total?: number } | null;
        status?: 'inProgress' | 'completed';
      }>;

      for (const block of blocks) {
        if (block.type === 'thinking' && block.thinking) {
          thinking = block.thinking;
        } else if (block.type === 'text' && block.text) {
          pushTextPart(block.text, 'final');
        } else if (block.type === 'codex_process_text' && block.text) {
          pushTextPart(block.text, 'process');
        } else if (block.type === 'codex_summary') {
          if (typeof block.elapsed_ms === 'number' && Number.isFinite(block.elapsed_ms)) {
            elapsedMs = block.elapsed_ms;
          }
          if (typeof block.process_count === 'number' && Number.isFinite(block.process_count)) {
            processCount = block.process_count;
          }
        } else if (
          block.type === 'codex_context_compaction' &&
          (block.status === 'inProgress' || block.status === 'completed')
        ) {
          flushPendingTools();
          renderParts.push({
            type: 'codex_context_compaction',
            status: block.status,
            sourceBreadcrumb:
              block.sourceBreadcrumb === 'app-server.item/started'
                ? 'app-server.item/started'
                : 'app-server.item/completed',
          });
        } else if (block.type === 'codex_proposed_plan' && block.text) {
          flushPendingTools();
          renderParts.push({
            type: 'proposed_plan',
            text: block.text,
            sourceBreadcrumb: block.sourceBreadcrumb || 'app-server.item/completed',
          });
        } else if (block.type === 'tool_use') {
          pushToolPart({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          });
        } else if (block.type === 'tool_result') {
          pushToolPart({
            type: 'tool_result',
            id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
            media: block.media,
          });
        }
      }
      flushPendingTools();

      return { text: visibleTextParts.join('\n\n'), tools, renderParts, thinking, elapsedMs, processCount };
    } catch {
      // Not valid JSON, fall through to legacy parsing
    }
  }

  // Legacy format: HTML comments
  text = content;
  const toolUseRegex = /<!--tool_use:([\s\S]*?)-->/g;
  let match;
  while ((match = toolUseRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      tools.push({ type: 'tool_use', ...parsed });
    } catch {
      // skip malformed
    }
    text = text.replace(match[0], '');
  }

  const toolResultRegex = /<!--tool_result:([\s\S]*?)-->/g;
  while ((match = toolResultRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      tools.push({ type: 'tool_result', ...parsed });
    } catch {
      // skip malformed
    }
    text = text.replace(match[0], '');
  }

  const trimmedText = text.trim();
  if (tools.length > 0) renderParts.push({ type: 'tools', tools });
  if (trimmedText) renderParts.push({ type: 'text', text: trimmedText, variant: 'final' });

  return { text: trimmedText, tools, renderParts };
}

function pairTools(tools: ToolBlock[]): PairedTool[] {
  const paired: PairedTool[] = [];

  const resultMap = new Map<string, ToolBlock>();
  for (const t of tools) {
    if (t.type === 'tool_result' && t.id) {
      resultMap.set(t.id, t);
    }
  }

  for (const t of tools) {
    if (t.type === 'tool_use' && t.name) {
      const result = t.id ? resultMap.get(t.id) : undefined;
      paired.push({
        name: t.name,
        input: t.input,
        result: result?.content,
        isError: result?.is_error,
        media: result?.media,
      });
    }
  }

  for (const t of tools) {
    if (t.type === 'tool_result' && !tools.some(u => u.type === 'tool_use' && u.id === t.id)) {
      paired.push({
        name: 'tool_result',
        input: {},
        result: t.content,
        isError: t.is_error,
        media: t.media,
      });
    }
  }

  return paired;
}

function parseMessageFiles(content: string): { files: FileAttachment[]; text: string } {
  const match = content.match(/^<!--files:(.*?)-->\n?/);
  if (!match) return { files: [], text: content };
  try {
    const files = JSON.parse(match[1]);
    const text = content.slice(match[0].length);
    return { files, text };
  } catch {
    return { files: [], text: content };
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await writeTextToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast({ type: 'warning', message: `复制失败，可以手动复制：${text}` });
    }
  }, [text]);

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleCopy}
      className="text-muted-foreground/60 hover:text-muted-foreground"
      title="复制"
      aria-label="复制"
    >
      {copied ? (
        <Check size={12} className="text-status-success-foreground" />
      ) : (
        <Copy size={12} aria-hidden />
      )}
    </Button>
  );
}

function TokenUsageDisplay({ usage }: { usage: TokenUsage }) {
  const totalTokens = usage.input_tokens + usage.output_tokens;
  const costStr = usage.cost_usd !== undefined && usage.cost_usd !== null
    ? ` · $${usage.cost_usd.toFixed(4)}`
    : '';

  return (
    <span className="group/tokens relative cursor-default text-xs text-muted-foreground/50">
      <span>{totalTokens.toLocaleString()} tokens{costStr}</span>
      <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-[11px] text-popover-foreground shadow-md border border-border/50 opacity-0 group-hover/tokens:opacity-100 transition-opacity duration-150 z-50">
        In: {usage.input_tokens.toLocaleString()} · Out: {usage.output_tokens.toLocaleString()}
        {usage.cache_read_input_tokens ? ` · Cache: ${usage.cache_read_input_tokens.toLocaleString()}` : ''}
        {costStr}
      </span>
    </span>
  );
}

const COLLAPSE_HEIGHT = 300;

export const MessageItem = memo(function MessageItem({ message, sessionId, canEdit = false, onEdit, onContinueInNewTask, isAssistantProject, assistantName }: MessageItemProps) {
  const isUser = message.role === 'user';
  const { t } = useTranslation();

  // Collapse/expand state for long user messages (hooks must be called unconditionally)
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isForking, setIsForking] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Preview wiring for DiffSummary (Phase 2.3). Clicking a previewable row
  // opens the artifact panel on that file. setPreviewSource auto-flips
  // previewOpen (see AppShell.tsx setPreviewSource side effects) so callers
  // don't need to set both.
  const { setPreviewSource, workingDirectory } = usePanel();


  // Memoize expensive parsing: parseToolBlocks + pairTools
  const { text, pairedTools, renderParts, thinking, elapsedMs, processCount } = useMemo(() => {
    const { text, tools, renderParts, thinking, elapsedMs, processCount } = parseToolBlocks(message.content);
    const pairedTools = pairTools(tools);
    return { text, pairedTools, renderParts, thinking, elapsedMs, processCount };
  }, [message.content]);

  // Memoize file attachment parsing
  const { files, fileExcerpts, displayText } = useMemo(() => {
    if (isUser) {
      const { files, text: textWithoutFiles } = parseMessageFiles(text);
      const parsedExcerpts = parseFileExcerptDisplay(textWithoutFiles);
      return {
        files,
        fileExcerpts: parsedExcerpts.references,
        displayText: parsedExcerpts.request,
      };
    }
    return { files: [] as FileAttachment[], fileExcerpts: [], displayText: text };
  }, [text, isUser]);

  useEffect(() => {
    if (isUser && contentRef.current) {
      setIsOverflowing(contentRef.current.scrollHeight > COLLAPSE_HEIGHT);
    }
  }, [isUser, displayText]);

  // Memoize token usage JSON parsing
  const tokenUsage = useMemo<TokenUsage | null>(() => {
    if (!message.token_usage) return null;
    try {
      return JSON.parse(message.token_usage);
    } catch {
      return null;
    }
  }, [message.token_usage]);

  // Hide image-gen system notices — they exist in DB for Claude's context but shouldn't render
  if (isUser && message.content.startsWith('[__IMAGE_GEN_NOTICE__')) {
    return null;
  }

  const timestamp = parseDBDate(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const submitEdit = useCallback(async () => {
    const content = editValue.trim();
    if ((!content && files.length === 0) || !onEdit || isSubmittingEdit) return;
    setIsSubmittingEdit(true);
    try {
      if (await onEdit(content, files)) {
        setIsEditing(false);
      }
    } finally {
      setIsSubmittingEdit(false);
    }
  }, [editValue, files, isSubmittingEdit, onEdit]);

  if (isUser && isEditing) {
    return (
      <AIMessage from="user" className="max-w-full" data-user-message-editor>
        <MessageContent className="w-full gap-3 rounded-2xl px-4 py-4">
          {files.length > 0 && <FileAttachmentDisplay files={files} />}
          <Textarea
            autoFocus
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !isSubmittingEdit) {
                setIsEditing(false);
              } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submitEdit();
              }
            }}
            disabled={isSubmittingEdit}
            aria-label={t('message.edit.input' as TranslationKey)}
            className="min-h-28 resize-y border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmittingEdit}
              onClick={() => setIsEditing(false)}
            >
              {t('message.edit.cancel' as TranslationKey)}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSubmittingEdit || (!editValue.trim() && files.length === 0)}
              onClick={() => void submitEdit()}
            >
              {t('message.edit.send' as TranslationKey)}
            </Button>
          </div>
        </MessageContent>
      </AIMessage>
    );
  }

  const hasAssistantProcess =
    !isUser && (!!thinking || renderParts.some((part) =>
      part.type === 'tools' ||
      part.type === 'codex_context_compaction' ||
      (part.type === 'text' && part.variant === 'process')
    ));
  const processParts = renderParts.filter((part) =>
    part.type === 'tools' ||
    part.type === 'codex_context_compaction' ||
    (part.type === 'text' && part.variant === 'process')
  );
  const planParts = renderParts.filter((part) => part.type === 'proposed_plan');
  const finalParts = renderParts.filter((part) => part.type === 'text' && part.variant === 'final');
  const renderAssistantPart = (part: AssistantRenderPart, index: number) => {
    if (part.type === 'tools') {
      const segmentTools = pairTools(part.tools);
      const segmentMedia = segmentTools.flatMap((tool) => tool.media || []);
      return (
        <Fragment key={`assistant-tools-${index}`}>
          <ToolActionsGroup
            tools={segmentTools.map((tool, i) => ({
              id: `hist-${index}-${i}`,
              name: tool.name,
              input: tool.input,
              result: tool.result,
              isError: tool.isError,
              media: tool.media,
            }))}
            defaultExpanded={false}
          />
          {segmentMedia.length > 0 && <MediaPreview media={segmentMedia} />}
        </Fragment>
      );
    }
    if (part.type === 'proposed_plan') {
      return (
        <ProposedPlanMessageBlock
          key={`assistant-proposed-plan-${index}`}
          block={{ type: 'codex_proposed_plan', text: part.text, sourceBreadcrumb: part.sourceBreadcrumb }}
        />
      );
    }
    if (part.type === 'codex_context_compaction') {
      return <ContextCompactionRow key={`assistant-context-compaction-${index}`} block={part} />;
    }
    return (
      <AssistantContent
        key={`assistant-text-${index}`}
        displayText={part.text}
        messageId={message.id}
        sessionId={sessionId}
      />
    );
  };

  // Assistant chat avatar removed (2026-05-21) — message bubbles already
  // carry assistant/user attribution via tone + alignment; the buddy
  // egg/species portrait next to every AI reply was visual noise and
  // duplicated identity already shown elsewhere (sidebar, composer
  // header). `isAssistantProject` is kept on the props since other
  // assistant-aware paths in this file may still reference it.

  return (
    <div>
      <div className="flex-1 min-w-0">
    <AIMessage from={isUser ? 'user' : 'assistant'}>
      <MessageContent>
        {/* File attachments for user messages */}
        {isUser && files.length > 0 && (
          <FileAttachmentDisplay files={files} />
        )}

        {isUser && fileExcerpts.length > 0 && (
          <FileExcerptDisplay references={fileExcerpts} />
        )}

        {/* Text content */}
        {isUser && displayText && (
          <div className="relative">
              {/* Round 14 (2026-05-23): switched the long-message
                  collapse from a CSS `transition: max-height` to
                  framer-motion `animate={{ height }}`. The CSS path
                  toggled between `maxHeight: 300px` and `undefined`
                  (== auto), which cannot interpolate — so expanding
                  and collapsing snapped instantly and looked like a
                  jarring flicker. motion.div measures the real
                  content height at run-time and tweens between the
                  collapsed pixel value and "auto" smoothly.
                  `initial={false}` skips a play on first paint so
                  long messages don't unfurl when they're rendered.
                  `overflow: hidden` clips the in-flight measure. */}
            <motion.div
              ref={contentRef}
              className="text-sm whitespace-pre-wrap break-words overflow-hidden"
              initial={false}
              animate={{ height: isOverflowing && !isExpanded ? COLLAPSE_HEIGHT : "auto" }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            >
              {displayText}
            </motion.div>
            {isOverflowing && !isExpanded && (
              <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-muted to-transparent pointer-events-none" />
            )}
            {isOverflowing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="relative z-10 flex items-center gap-1 mt-1 text-xs text-muted-foreground hover:text-foreground h-auto px-1 py-0.5"
              >
                {isExpanded ? (
                  <>
                    <CaretUp size={12} />
                    <span>收起</span>
                  </>
                ) : (
                  <>
                    <CaretDown size={12} />
                    <span>展开</span>
                  </>
                )}
              </Button>
            )}
          </div>
        )}

        {!isUser && (
          <>
            {hasAssistantProcess && (
              <ProcessCollapseGroup
                elapsedMs={elapsedMs}
                processCount={processCount}
                defaultExpanded={false}
              >
                {thinking && (
                  <ToolActionsGroup
                    tools={[]}
                    thinkingContent={thinking}
                    defaultExpanded={false}
                  />
                )}
                {processParts.map((part, index) => renderAssistantPart(part, index))}
              </ProcessCollapseGroup>
            )}
            {planParts.map((part, index) => renderAssistantPart(part, index))}
            {finalParts.length > 0 && (
              <div className="contents" data-assistant-final-answer data-answer-complete="true">
                {finalParts.map((part, index) => renderAssistantPart(part, index))}
              </div>
            )}
            {finalParts.length === 0 && planParts.length === 0 && !hasAssistantProcess && (
              <div className="contents" data-assistant-final-answer data-answer-complete="true">
                {renderParts.map((part, index) => renderAssistantPart(part, index))}
              </div>
            )}
          </>
        )}
      </MessageContent>

      {/* Diff summary for assistant messages with file modifications */}
      {!isUser && (() => {
        // Phase 4: write-tool classification + path resolution now live
        // in `src/lib/file-write-tools.ts` so the same set powers both
        // the DiffSummary cards here and the codepilot:file-changed
        // dispatch in stream-session-manager. Anywhere a new variant
        // (e.g. multi_edit) lands, both surfaces pick it up.
        const modifiedFiles = pairedTools
          .filter(t => isWriteTool(t.name) && !t.isError)
          .map(t => {
            const rawPath = extractWritePath(t.input);
            const resolvedPath = resolveToolPath(rawPath, workingDirectory);
            const parts = resolvedPath.split(/[/\\]/);
            const operation: 'created' | 'modified' = isCreateTool(t.name) ? 'created' : 'modified';
            return { path: resolvedPath, name: parts[parts.length - 1] || resolvedPath, operation };
          })
          .filter(f => f.path);
        if (modifiedFiles.length === 0) return null;
        // Deduplicate by path. When the same file appears multiple times (e.g.
        // created then edited in one turn), the last tool wins — callers see
        // "Modified" rather than "Created" which matches the file's final
        // state at the end of the turn.
        const unique = [...new Map(modifiedFiles.map(f => [f.path, f])).values()];
        return (
          <DiffSummary
            files={unique}
            onPreview={(file) => {
              // Phase 4: classify the path against the session's
              // workingDirectory. Inside the workspace → workspace trust
              // + baseDir, opens directly. Outside → agent-referenced,
              // which makes PreviewPanel render a confirm card and
              // delay fetch until the user explicitly accepts (path
              // could be a sensitive location named by the AI). The
              // panel transitions to user-selected/readonly on confirm.
              const { trust, baseDir, readonly } = classifyPath(file.path, workingDirectory);
              setPreviewSource({
                kind: 'file',
                filePath: file.path,
                trust,
                ...(baseDir ? { baseDir } : {}),
                readonly,
              });
            }}
          />
        );
      })()}

      {/* Footer with copy, timestamp and token usage */}
      <div className={`flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${isUser ? 'justify-end' : ''}`}>
        <div className="flex items-center gap-0.5">
          {displayText && <CopyButton text={displayText} />}
          {!isUser && onContinueInNewTask && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={isForking}
              onClick={async () => {
                setIsForking(true);
                try { await onContinueInNewTask(message.turn_id, message.id); }
                catch { showToast({ type: 'error', message: t('error.sessionCreateFailed' as TranslationKey) }); }
                finally { setIsForking(false); }
              }}
              className="text-muted-foreground/60 hover:text-primary"
              aria-label={t('message.continueInNewTask' as TranslationKey)}
              title={t('message.continueInNewTask' as TranslationKey)}
            >
              {isForking ? <SpinnerGap size={13} className="animate-spin" /> : <ArrowsSplit size={13} style={{ transform: 'rotate(-90deg)' }} />}
            </Button>
          )}
        </div>
        {!isUser && <span className="text-xs text-muted-foreground/50">{timestamp}</span>}
        {!isUser && tokenUsage && <TokenUsageDisplay usage={tokenUsage} />}
        {isUser && canEdit && fileExcerpts.length === 0 && onEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              setEditValue(displayText);
              setIsEditing(true);
            }}
            aria-label={t('message.edit' as TranslationKey)}
            title={t('message.edit' as TranslationKey)}
          >
            <NotePencil size={13} />
          </Button>
        )}
      </div>
    </AIMessage>
      </div>
    </div>
  );
});

const AssistantContent = memo(function AssistantContent({ displayText }: { displayText: string; messageId: string; sessionId?: string }) {
  return displayText ? <DevOutputSegment text={displayText} /> : null;
});
