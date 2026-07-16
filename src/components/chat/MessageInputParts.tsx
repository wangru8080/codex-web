'use client';

import { useEffect, useCallback, useMemo } from 'react';
import { ArrowUp, X, Stop, NotePencil } from '@/components/ui/icon';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { Button } from '@/components/ui/button';
import {
  PromptInputSubmit,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { ChatStatus } from 'ai';
import { isSubmitEnabled } from '@/lib/message-input-logic';
import type { MentionRef, CommandBadge as CommandBadgeType } from '@/types';
import type { FileExcerptReference } from '@/lib/file-excerpt-reference';

/**
 * Submit button that's aware of file attachments. Must be rendered inside PromptInput.
 */
export function FileAwareSubmitButton({
  status,
  onStop,
  disabled,
  inputValue,
  hasBadge,
  hasContext = false,
}: {
  status: ChatStatus;
  onStop?: () => void;
  disabled?: boolean;
  inputValue: string;
  hasBadge: boolean;
  hasContext?: boolean;
}) {
  const attachments = usePromptInputAttachments();
  const { t } = useTranslation();
  const hasFiles = attachments.files.length > 0 || hasContext;
  const isStreaming = status === 'streaming' || status === 'submitted';

  // During streaming only plain text can queue. Slash commands and badges
  // are blocked by handleSubmit(), so the button must not advertise
  // sendability for those paths.
  const trimmed = inputValue.trim();
  const canQueue = isStreaming
    && !!trimmed
    && !hasBadge
    && !trimmed.startsWith('/');

  const enabled = isSubmitEnabled({
    inputValue,
    hasBadge,
    hasFiles,
    isStreaming,
    disabled: !!disabled,
  });
  const canStop = isStreaming && !canQueue && !!onStop;

  return (
    <PromptInputSubmit
      status={canQueue ? 'ready' : status}
      onStop={canQueue ? undefined : onStop}
      disabled={!enabled && !canStop}
      aria-label={t((canStop ? 'messageInput.stopAriaLabel' : 'messageInput.submitAriaLabel') as TranslationKey)}
      // Stable hook for programmatic clicks. The Run Checkpoint Round 2
      // confirm-and-send flow needs to find this button in a locale-
      // agnostic way; aria-label is i18n'd ("发送消息" in zh) and
      // would miss in non-en locales. (Codex P2, 2026-04-30.)
      data-message-input-submit=""
      className="rounded-full"
    >
      {canQueue ? (
        <ArrowUp size={16} />
      ) : isStreaming ? (
        <Stop size={16} />
      ) : (
        <ArrowUp size={16} />
      )}
    </PromptInputSubmit>
  );
}

/**
 * Bridge component that listens for 'attach-file-to-chat' custom events
 * from the file tree and adds the file as a proper attachment (capsule).
 * Uses /api/files/raw to fetch the real file binary, preserving type and content.
 */
export function FileTreeAttachmentBridge({ imageOnly = false }: { imageOnly?: boolean }) {
  const attachments = usePromptInputAttachments();

  const handleAttach = useCallback(async (filePath: string) => {
    try {
      const res = await fetch(`/api/files/raw?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) {
        // Fallback: insert as @mention if the raw API fails
        window.dispatchEvent(new CustomEvent('insert-file-mention', { detail: { path: filePath } }));
        return;
      }
      const blob = await res.blob();
      const fileName = filePath.split('/').pop() || 'file';
      // Use the content-type from the server response (it resolves from extension)
      const contentType = res.headers.get('content-type') || 'application/octet-stream';
      if (imageOnly && !contentType.startsWith('image/')) {
        window.dispatchEvent(new CustomEvent('insert-file-mention', { detail: { path: filePath } }));
        return;
      }
      const file = new File([blob], fileName, { type: contentType });
      attachments.add([file]);
    } catch {
      // Fallback: insert as @mention if fetch fails
      window.dispatchEvent(new CustomEvent('insert-file-mention', { detail: { path: filePath } }));
    }
  }, [attachments, imageOnly]);

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string }>;
      const filePath = customEvent.detail?.path;
      if (!filePath) return;
      handleAttach(filePath);
    };

    window.addEventListener('attach-file-to-chat', handler);
    return () => window.removeEventListener('attach-file-to-chat', handler);
  }, [handleAttach]);

  return null;
}

function formatChipTokens(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 100 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '')) + 'K';
  }
  return String(n);
}

/**
 * Headless emitter — sums the byte size of every PromptInput attachment
 * (preserved as `size` since the April 2026 fix in `prompt-input.tsx`)
 * and reports the rough token total upstream. Lives inside `PromptInput`
 * because `usePromptInputAttachments` only resolves there. Returns null;
 * the only side effect is the parent's pending-token accounting.
 */
export function AttachmentPendingTracker({
  onChange,
}: {
  onChange: (tokens: number) => void;
}) {
  const attachments = usePromptInputAttachments();
  const total = useMemo(() => {
    let sum = 0;
    for (const file of attachments.files) {
      const size = (file as unknown as { size?: number }).size;
      if (typeof size === 'number' && size > 0) sum += Math.ceil(size / 4);
    }
    return sum;
  }, [attachments.files]);
  useEffect(() => {
    onChange(total);
  }, [total, onChange]);
  return null;
}

/**
 * Capsule display for attached files, rendered inside PromptInput context.
 */
export function FileAttachmentsCapsules() {
  const attachments = usePromptInputAttachments();
  const { t } = useTranslation();

  if (attachments.files.length === 0) return null;

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 px-3 pt-2 pb-0 order-first">
      {attachments.files.map((file) => {
        const isImage = file.mediaType?.startsWith('image/');
        // The PromptInput attachment carries either a base64 data URL or
        // a remote URL, but always exposes a `.size` byte count we can
        // estimate from. `bytes / 4` is the standard rough heuristic;
        // see `useMentionTokenEstimate` for the same approach on @ chips.
        const sizeBytes = (file as unknown as { size?: number }).size;
        const estimate = typeof sizeBytes === 'number' && sizeBytes > 0
          ? Math.ceil(sizeBytes / 4)
          : null;
        return (
          <span
            key={file.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted pl-2 pr-1 py-0.5 text-xs font-medium text-foreground"
          >
            {isImage && file.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={file.url}
                alt={file.filename || 'image'}
                className="h-5 w-5 rounded object-cover"
              />
            ) : (
              <CodexWebIcon name="file" size={12} className="text-muted-foreground" aria-hidden />
            )}
            <span className="max-w-[120px] truncate text-[11px]">
              {file.filename || 'file'}
            </span>
            {estimate !== null && (
              <span className="text-[10px] font-normal text-muted-foreground">
                ~{formatChipTokens(estimate)}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => attachments.remove(file.id)}
              aria-label={t('messageInput.removeChipAriaLabel' as TranslationKey, { name: file.filename || 'file' })}
              className="ml-0.5 h-auto w-auto rounded-full p-0.5 hover:bg-accent"
            >
              <X size={12} />
            </Button>
          </span>
        );
      })}
    </div>
  );
}

export function FileReferenceCapsules({
  paths,
  onRemove,
}: {
  paths: ReadonlyArray<string>;
  onRemove: (path: string) => void;
}) {
  const { t } = useTranslation();
  if (paths.length === 0) return null;

  return (
    <div className="flex w-full flex-wrap items-center gap-2 px-3 pt-2.5 pb-0 order-first">
      {paths.map((path) => {
        const fileName = path.split(/[\\/]/).pop() || path;
        const extension = fileName.includes(".") ? fileName.split(".").pop()?.toUpperCase() : "FILE";
        return (
          <div
            key={path}
            data-file-reference-path={path}
            className="relative flex min-w-[220px] max-w-[360px] items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2 shadow-sm"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
              <CodexWebIcon name="file_code" size="md" className="text-muted-foreground" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{fileName}</div>
              <div className="text-xs text-muted-foreground">{extension}</div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(path)}
              aria-label={t('messageInput.removeChipAriaLabel' as TranslationKey, { name: fileName })}
              className="absolute right-1 top-1 size-6 rounded-full p-0"
            >
              <X size={12} />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export function FileExcerptCapsules({
  excerpts,
  onRemove,
}: {
  excerpts: ReadonlyArray<FileExcerptReference>;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (excerpts.length === 0) return null;

  return (
    <div className="flex w-full flex-wrap items-center gap-2 px-3 pt-2.5 pb-0 order-first">
      {excerpts.map((excerpt) => {
        const extension = excerpt.name.includes(".")
          ? excerpt.name.split(".").pop()?.toUpperCase()
          : "FILE";
        const lineRange = excerpt.startLine && excerpt.endLine
          ? `${excerpt.startLine}-${excerpt.endLine}`
          : null;
        return (
          <div
            key={excerpt.id}
            data-file-excerpt-path={excerpt.path}
            className="relative flex min-w-[220px] max-w-[360px] items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2 shadow-sm"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
              <CodexWebIcon name="file_code" size="md" className="text-muted-foreground" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{excerpt.name}</div>
              <div className="text-xs text-muted-foreground">
                {extension}{lineRange ? ` · ${lineRange}` : ""}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(excerpt.id)}
              aria-label={t('messageInput.removeChipAriaLabel' as TranslationKey, { name: excerpt.name })}
              className="absolute right-1 top-1 size-6 rounded-full p-0"
            >
              <X size={12} />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Directory references attached via the file tree's "+" button. Same
 * unified muted chip styling as the rest of the composer's chip row
 * (files, mentions, slash commands, CLI badge) — type is signalled by
 * the icon, never by colour. Colour is reserved for error / dangerous
 * states per the three-layer visual rule in
 * `feedback_composer_invisible_until_hover.md`.
 */
export function DirectoryRefsCapsules({
  paths,
  onRemove,
  estimates,
}: {
  paths: ReadonlyArray<string>;
  onRemove: (path: string) => void;
  estimates?: Record<string, number | null>;
}) {
  const { t } = useTranslation();
  if (paths.length === 0) return null;
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 px-3 pt-2 pb-0 order-first">
      {paths.map((path) => {
        const est = estimates?.[path];
        return (
          <span
            key={path}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted pl-2 pr-1 py-0.5 text-xs font-medium text-foreground"
          >
            <CodexWebIcon name="folder" size={12} className="text-muted-foreground" aria-hidden />
            <span className="max-w-[160px] truncate text-[11px] font-mono">
              {path}
            </span>
            {est != null && est > 0 && (
              <span className="text-[10px] font-normal text-muted-foreground">
                ~{formatChipTokens(est)}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(path)}
              aria-label={t('messageInput.removeChipAriaLabel' as TranslationKey, { name: path })}
              className="ml-0.5 h-auto w-auto rounded-full p-0.5 hover:bg-accent"
            >
              <X size={12} />
            </Button>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Slash-command badge chip — shows just the command label. Description used
 * to be rendered next to it but took too much horizontal space (user feedback),
 * and is already visible in the picker before selection anyway.
 *
 * Used by CommandBadgeList for both single- and multi-badge display.
 */
export function CommandBadge({
  badge,
  onRemove,
}: {
  badge: CommandBadgeType;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const icon = badge.kind === 'agent_skill'
    ? <CodexWebIcon name="skill" size={12} aria-hidden />
    : badge.kind === 'codepilot_command'
      ? <CodexWebIcon name="code" size={12} aria-hidden />
      : <NotePencil size={12} />;

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted pl-2.5 pr-1 py-1 text-xs font-medium text-foreground">
      <span className="text-muted-foreground">{icon}</span>
      <span className="font-mono">{badge.command}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label={t('messageInput.removeChipAriaLabel' as TranslationKey, { name: badge.command })}
        className="ml-0.5 h-auto w-auto rounded-full p-0.5 hover:bg-accent"
      >
        <X size={12} />
      </Button>
    </span>
  );
}

/**
 * Wrapper that renders zero or more CommandBadges above the textarea. Uses
 * flex-wrap so the chips flow to a new line when they won't fit. Replaces
 * the old single-badge render block in MessageInput.
 */
export function CommandBadgeList({
  badges,
  onRemove,
}: {
  badges: ReadonlyArray<CommandBadgeType>;
  onRemove: (command: string) => void;
}) {
  if (badges.length === 0) return null;
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 px-3 pt-2.5 pb-0 order-first">
      {badges.map((b) => (
        <CommandBadge key={b.command} badge={b} onRemove={() => onRemove(b.command)} />
      ))}
    </div>
  );
}

/**
 * CLI tool badge displayed above the textarea.
 */
export function CliBadge({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full items-center gap-1.5 px-3 pt-2.5 pb-0 order-first">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted pl-2.5 pr-1.5 py-1 text-xs font-medium text-foreground">
        <CodexWebIcon name="cli" size={12} className="text-muted-foreground" aria-hidden />
        <span>CLI: {name}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={t('messageInput.removeChipAriaLabel' as TranslationKey, { name })}
          className="ml-0.5 h-auto w-auto rounded-full p-0.5 hover:bg-accent"
        >
          <X size={12} />
        </Button>
      </span>
    </div>
  );
}

/**
 * Mention badge for structured @ references.
 */
function MentionBadge({
  mention,
  onRemove,
  estimateTokens,
}: {
  mention: MentionRef;
  onRemove: (mention: MentionRef) => void;
  /** Pre-fetch heuristic estimate of how many context tokens this
   *  reference will spend. `null` while the request is in flight or
   *  when the file size is unavailable; in those cases the chip just
   *  hides the estimate column. */
  estimateTokens?: number | null;
}) {
  const { t } = useTranslation();
  const isDirectory = mention.nodeType === 'directory';
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted pl-2.5 pr-1 py-1 text-xs font-medium text-foreground">
      {isDirectory
        ? <CodexWebIcon name="folder" size={12} className="text-muted-foreground" aria-hidden />
        : <CodexWebIcon name="file" size={12} className="text-muted-foreground" aria-hidden />}
      <span className="font-mono truncate max-w-[180px]">
        @{mention.display}{isDirectory ? '/' : ''}
      </span>
      {estimateTokens != null && estimateTokens > 0 && (
        <span className="text-[10px] font-normal text-muted-foreground">
          ~{formatChipTokens(estimateTokens)}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onRemove(mention)}
        aria-label={t('messageInput.removeChipAriaLabel' as TranslationKey, { name: `@${mention.display}${isDirectory ? '/' : ''}` })}
        className="ml-0.5 h-auto w-auto rounded-full p-0.5 hover:bg-accent"
      >
        <X size={12} />
      </Button>
    </span>
  );
}

export function MentionBadgeList({
  mentions,
  onRemove,
  estimates,
}: {
  mentions: MentionRef[];
  onRemove: (mention: MentionRef) => void;
  estimates?: Record<string, number | null>;
}) {
  if (mentions.length === 0) return null;
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 px-3 pt-2.5 pb-0 order-first">
      {mentions.map((m) => (
        <MentionBadge
          key={`${m.path}-${m.nodeType}`}
          mention={m}
          onRemove={onRemove}
          estimateTokens={estimates?.[m.path]}
        />
      ))}
    </div>
  );
}

/**
 * Unified row for command badges and @mention badges so they appear in one line-flow.
 */
export function ComposerBadgeRow({
  badges,
  mentions,
  badgeOrder,
  mentionOrder,
  onRemoveBadge,
  onRemoveMention,
  mentionEstimates,
}: {
  badges: ReadonlyArray<CommandBadgeType>;
  mentions: MentionRef[];
  badgeOrder: Record<string, number>;
  mentionOrder: Record<string, number>;
  onRemoveBadge: (command: string) => void;
  onRemoveMention: (mention: MentionRef) => void;
  /** Path → estimated tokens. Forwarded to each MentionBadge. */
  mentionEstimates?: Record<string, number | null>;
}) {
  if (badges.length === 0 && mentions.length === 0) return null;

  const mixed = [
    ...badges.map((b, idx) => ({
      kind: 'badge' as const,
      order: badgeOrder[b.command] ?? 100000 + idx,
      key: `badge-${b.command}`,
      badge: b,
    })),
    ...mentions.map((m, idx) => ({
      kind: 'mention' as const,
      order: mentionOrder[m.path] ?? (m.sourceRange?.start ?? 200000 + idx),
      key: `mention-${m.path}-${m.nodeType}-${m.sourceRange?.start ?? idx}`,
      mention: m,
    })),
  ].sort((a, b) => a.order - b.order);

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 px-3 pt-2.5 pb-0 order-first">
      {mixed.map((item) =>
        item.kind === 'badge'
          ? <CommandBadge key={item.key} badge={item.badge} onRemove={() => onRemoveBadge(item.badge.command)} />
          : <MentionBadge
              key={item.key}
              mention={item.mention}
              onRemove={onRemoveMention}
              estimateTokens={mentionEstimates?.[item.mention.path]}
            />
      )}
    </div>
  );
}
