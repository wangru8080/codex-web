/**
 * Pure algorithm functions for MessageInput behavior.
 *
 * These functions contain no React dependencies — they are plain TypeScript
 * and can be tested directly without any framework setup.
 */

import { BUILT_IN_COMMANDS, COMMAND_PROMPTS } from '@/lib/constants/commands';
import type {
  PopoverItem,
  PopoverMode,
  CommandBadge,
  CliBadge,
  MentionNodeType,
  MentionRef,
  FileAttachment,
} from '@/types';

/** MIME type used for synthetic directory attachments. Backend in
 * `/api/chat/route.ts` skips disk write for this type and just
 * preserves `filePath`. Kept in sync via this constant so tests and
 * the route handler reference the same string. */
export const DIRECTORY_ATTACHMENT_MIME = 'inode/directory';

// ─── Result types ────────────────────────────────────────────────

export interface InsertResult {
  action: 'immediate_command' | 'set_badge' | 'insert_file_mention';
  commandValue?: string;
  badge?: CommandBadge;
  newInputValue?: string;
}

export interface BadgeDispatchResult {
  prompt: string;
  displayLabel: string;
}

export type KeyAction =
  | { type: 'popover_navigate'; direction: 'up' | 'down' }
  | { type: 'popover_select' }
  | { type: 'close_popover' }
  | { type: 'remove_badge' }
  | { type: 'remove_cli_badge' }
  | { type: 'passthrough' };

export interface DirectSlashResult {
  action: 'immediate_command' | 'set_badge' | 'unknown_slash_badge' | 'not_slash';
  commandValue?: string;
  badge?: CommandBadge;
}

// ─── Functions ───────────────────────────────────────────────────

/**
 * Detects popover trigger from input text and cursor position.
 * Used by handleInputChange in useSlashCommands.
 */
export function detectPopoverTrigger(
  text: string,
  cursorPos: number,
): { mode: PopoverMode; filter: string; triggerPos: number } | null {
  const beforeCursor = text.slice(0, cursorPos);

  // Check for @ trigger
  const atMatch = beforeCursor.match(/@([^\s@]*)$/);
  if (atMatch) {
    return {
      mode: 'file',
      filter: atMatch[1],
      triggerPos: cursorPos - atMatch[0].length,
    };
  }

  // Check for / trigger. Only fires when `/` is at the start of input or
  // immediately after whitespace — regex alone can't tell "hello/skill" from
  // "src/app" or "foo/bar", so we accept the trade-off: typing `/` mid-word
  // does NOT open the picker (it would false-positive on every single-slash
  // path). Users who want to invoke a command mid-sentence use the slash
  // button, which auto-inserts a leading space (see handleInsertSlash).
  const slashMatch = beforeCursor.match(/(^|\s)\/([^\s]*)$/);
  if (slashMatch) {
    return {
      mode: 'skill',
      filter: slashMatch[2],
      triggerPos: cursorPos - slashMatch[2].length - 1,
    };
  }

  return null;
}

/**
 * Filters popover items by substring match on label or description.
 * Used by the filteredItems useMemo in usePopoverState.
 */
export function filterItems(items: PopoverItem[], filter: string): PopoverItem[] {
  const q = filter.toLowerCase();
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      (item.description || '').toLowerCase().includes(q),
  );
}

/**
 * Splits input text around a popover trigger, removing the trigger character
 * and any filter text that was typed after it.
 */
function splitAroundTrigger(
  inputValue: string,
  triggerPos: number,
  popoverFilter: string,
): { before: string; after: string } {
  const before = inputValue.slice(0, triggerPos);
  const cursorEnd = triggerPos + popoverFilter.length + 1; // +1 to consume the trigger character
  const after = inputValue.slice(cursorEnd);
  return { before, after };
}

/**
 * Determines what happens when an item is selected from the popover.
 * Used by insertItem in useSlashCommands.
 */
export function resolveItemSelection(
  item: PopoverItem,
  popoverMode: PopoverMode,
  triggerPos: number,
  inputValue: string,
  popoverFilter: string,
): InsertResult {
  // Immediate built-in commands
  if (item.builtIn && item.immediate) {
    return { action: 'immediate_command', commandValue: item.value };
  }

  // Non-immediate commands: show as badge, preserving any text outside the trigger
  if (popoverMode === 'skill') {
    const { before, after } = splitAroundTrigger(inputValue, triggerPos, popoverFilter);
    return {
      action: 'set_badge',
      badge: {
        command: item.value,
        label: item.label,
        description: item.description || '',
        kind: item.kind || 'slash_command',
        installedSource: item.installedSource,
      },
      newInputValue: before + after,
    };
  }

  // File mention: insert into text
  const { before, after } = splitAroundTrigger(inputValue, triggerPos, popoverFilter);
  const insertText = `@${item.value} `;
  return {
    action: 'insert_file_mention',
    newInputValue: before + insertText + after,
  };
}

/**
 * Badge dispatch logic — what prompt is sent for each badge kind.
 * Used by handleSubmit in MessageInput.
 *
 * Accepts a single badge or an array. Multi-badge is only meaningful for
 * `agent_skill` kind (user can stack multiple skills); other kinds always
 * arrive as a single-element array because addBadge() replaces on non-skill.
 */
export function dispatchBadge(
  badgeOrBadges: CommandBadge | CommandBadge[],
  userContent: string,
): BadgeDispatchResult {
  const badges = Array.isArray(badgeOrBadges) ? badgeOrBadges : [badgeOrBadges];
  if (badges.length === 0) {
    return { prompt: userContent, displayLabel: userContent };
  }

  // Multi-skill path: combine labels into one prompt, join display labels.
  if (badges.length > 1 && badges.every((b) => b.kind === 'agent_skill')) {
    const skillNames = badges.map((b) => b.label).join(', ');
    const displayLabel = userContent
      ? `${badges.map((b) => `/${b.label}`).join(' ')}\n${userContent}`
      : badges.map((b) => `/${b.label}`).join(' ');
    const agentPrompt = userContent
      ? `Use the ${skillNames} skills. User context: ${userContent}`
      : `Please use the ${skillNames} skills.`;
    return { prompt: agentPrompt, displayLabel };
  }

  const badge = badges[0];
  const baseLabel = `/${badge.label}`;
  const displayLabel = userContent ? `${baseLabel}\n${userContent}` : baseLabel;

  switch (badge.kind) {
    case 'agent_skill': {
      const agentPrompt = userContent
        ? `Use the ${badge.label} skill. User context: ${userContent}`
        : `Please use the ${badge.label} skill.`;
      return { prompt: agentPrompt, displayLabel };
    }
    case 'slash_command':
    case 'sdk_command': {
      const slashPrompt = userContent
        ? `${badge.command} ${userContent}`
        : badge.command;
      return { prompt: slashPrompt, displayLabel };
    }
    case 'codepilot_command': {
      const expandedPrompt = COMMAND_PROMPTS[badge.command] || '';
      const finalPrompt = userContent
        ? `${expandedPrompt}\n\nUser context: ${userContent}`
        : expandedPrompt || badge.command;
      return { prompt: finalPrompt, displayLabel };
    }
  }
}

/**
 * ArrowDown/ArrowUp index cycling logic.
 * Used by handleKeyDown popover navigation in MessageInput.
 */
export function cycleIndex(current: number, direction: 'up' | 'down', length: number): number {
  if (direction === 'down') return (current + 1) % length;
  return (current - 1 + length) % length;
}

/**
 * Submit gating logic — determines whether submit is enabled.
 * Used by FileAwareSubmitButton disabled logic.
 */
export function isSubmitEnabled(opts: {
  inputValue: string;
  hasBadge: boolean;
  hasFiles: boolean;
  isStreaming: boolean;
  disabled: boolean;
}): boolean {
  if (opts.disabled) return false;
  if (opts.isStreaming) return true; // streaming = stop button
  return !!(opts.inputValue.trim() || opts.hasBadge || opts.hasFiles);
}

/**
 * Keyboard dispatch logic — determines what action to take for a given key.
 * Used by handleKeyDown in MessageInput.
 */
export function resolveKeyAction(
  key: string,
  state: {
    popoverMode: PopoverMode;
    popoverHasItems: boolean;
    inputValue: string;
    hasBadge: boolean;
    hasCliBadge: boolean;
  },
): KeyAction {
  // Popover navigation (skill/file mode)
  if (state.popoverMode && state.popoverMode !== 'cli' && state.popoverHasItems) {
    if (key === 'ArrowDown') return { type: 'popover_navigate', direction: 'down' };
    if (key === 'ArrowUp') return { type: 'popover_navigate', direction: 'up' };
    if (key === 'Enter' || key === 'Tab') return { type: 'popover_select' };
    if (key === 'Escape') return { type: 'close_popover' };
  }

  // CLI popover
  if (state.popoverMode === 'cli') {
    if (key === 'Escape') return { type: 'close_popover' };
  }

  // Backspace removes badge when input is empty
  if (key === 'Backspace' && !state.inputValue) {
    if (state.hasBadge) return { type: 'remove_badge' };
    if (state.hasCliBadge) return { type: 'remove_cli_badge' };
  }

  // Escape removes badge
  if (key === 'Escape') {
    if (state.hasBadge) return { type: 'remove_badge' };
    if (state.hasCliBadge) return { type: 'remove_cli_badge' };
  }

  return { type: 'passthrough' };
}

/**
 * Direct slash command detection — when user types "/command" in input and submits.
 * Used by handleSubmit in MessageInput.
 */
export function resolveDirectSlash(content: string): DirectSlashResult {
  if (!content.startsWith('/')) return { action: 'not_slash' };

  const cmd = BUILT_IN_COMMANDS.find((c) => c.value === content);
  if (cmd) {
    if (cmd.immediate) {
      return { action: 'immediate_command', commandValue: content };
    }
    return {
      action: 'set_badge',
      badge: {
        command: cmd.value,
        label: cmd.label,
        description: cmd.description || '',
        kind: cmd.kind || 'sdk_command',
      },
    };
  }

  const skillName = content.slice(1);
  if (skillName) {
    return {
      action: 'unknown_slash_badge',
      badge: {
        command: content,
        label: skillName,
        description: '',
        kind: 'slash_command',
      },
    };
  }

  return { action: 'not_slash' };
}

/**
 * CLI badge system prompt append generation.
 * Used by handleSubmit in MessageInput.
 */
export function buildCliAppend(cliBadge: CliBadge | null): string | undefined {
  if (!cliBadge) return undefined;
  return `The user wants to use the installed CLI tool "${cliBadge.name}" if appropriate for this task. Prefer using "${cliBadge.name}" when suitable.`;
}

/**
 * Parse @mentions from raw input text and return structured mention refs.
 * Mentions keep source ranges so the caller can reconcile edits/deletions.
 */
export function parseMentionRefs(
  input: string,
  nodeTypeLookup?: Record<string, MentionNodeType>,
): MentionRef[] {
  const refs: MentionRef[] = [];
  if (!input) return refs;

  const mentionRegex = /(^|\s)@([^\s@]+)/g;
  for (const match of input.matchAll(mentionRegex)) {
    const rawPath = (match[2] || '').replace(/[.,!?;:)\]}]+$/, '');
    if (!rawPath) continue;
    const full = match[0] || '';
    const start = input.indexOf(full, match.index ?? 0) + full.lastIndexOf('@');
    const end = start + rawPath.length + 1;
    refs.push({
      path: rawPath,
      nodeType: nodeTypeLookup?.[rawPath] || 'file',
      display: rawPath,
      sourceRange: { start, end },
    });
  }
  return refs;
}

/**
 * Dedupe mentions by path (first mention wins).
 */
export function dedupeMentionsByPath(mentions: MentionRef[]): MentionRef[] {
  const seen = new Set<string>();
  const out: MentionRef[] = [];
  for (const mention of mentions) {
    if (seen.has(mention.path)) continue;
    seen.add(mention.path);
    out.push(mention);
  }
  return out;
}

// =====================================================================
// Send payload composition (Context chips Phase 1)
// =====================================================================

/**
 * Convert directory paths attached via the file-tree "+" button into
 * synthetic FileAttachment entries. They ride the same
 * `<!--files:...-->` marker pipeline as real files so they render as
 * chips in the bubble; the backend recognises `inode/directory` and
 * skips disk persistence (see `/api/chat/route.ts`).
 */
export function buildDirectoryAttachments(directoryRefs: ReadonlyArray<string>): FileAttachment[] {
  return directoryRefs.map((path) => ({
    id: `dir-${path}`,
    name: path.split(/[\\/]/).filter(Boolean).pop() || path,
    type: DIRECTORY_ATTACHMENT_MIME,
    size: 0,
    data: '',
    filePath: path,
  }));
}

/**
 * Build the LLM-context append block from the resolved mention payload.
 * Returns `''` (no leading newlines) when nothing to append. Caller
 * concatenates with the user-typed content to form `finalContent`.
 *
 * The two sections are:
 * - `[Referenced Directories]` — directory tree summaries
 * - `[Mention Limits]` — explanations for mentions/dirs that were dropped
 */
export function buildMentionAppend(
  directoryNotes: ReadonlyArray<string>,
  limitNotes: ReadonlyArray<string>,
): string {
  const sections: string[] = [];
  if (directoryNotes.length > 0) {
    sections.push(`[Referenced Directories]\n${directoryNotes.join('\n\n')}`);
  }
  if (limitNotes.length > 0) {
    sections.push(`[Mention Limits]\n${limitNotes.map((x) => `- ${x}`).join('\n')}`);
  }
  return sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';
}

/**
 * Compose the final content sent to the model: user-typed content +
 * the mention append block, then trimmed.
 */
export function composeFinalContent(content: string, mentionAppend: string): string {
  return `${content}${mentionAppend}`.trim();
}

/**
 * Decide what to display in the user message bubble. When the user
 * attached @ mentions or + directory chips, the LLM gets the inflated
 * `[Referenced Directories]` block but the bubble shows only the raw
 * user content (the chips above the bubble already convey the rest).
 *
 * Returns `undefined` when there's nothing to override — the caller
 * then falls back to `finalContent`.
 */
export function computeDisplayOverride(
  rawContent: string,
  hasMentions: boolean,
  hasDirRefs: boolean,
): string | undefined {
  return (hasMentions || hasDirRefs) ? rawContent : undefined;
}

/**
 * Sum the rough token cost of all currently-pending context sources:
 * PromptInput attachments (already pre-summed by the headless tracker),
 * @ mention chips, and + directory chips. Used by both the per-row
 * "+pending" annotation and the Run status panel preview.
 *
 * When all sources are empty, returns 0 — that's the post-send invariant.
 */
export function computePendingContextTokens(opts: {
  attachmentPendingTokens: number;
  uniqueMentions: ReadonlyArray<MentionRef>;
  /** `null` means estimate still loading — counted as 0 so the user
   * doesn't see a flicker between "?" and the real number. */
  mentionEstimates: Readonly<Record<string, number | null | undefined>>;
  directoryRefs: ReadonlyArray<string>;
  directoryRefEstimates: Readonly<Record<string, number | null | undefined>>;
}): number {
  let sum = opts.attachmentPendingTokens;
  for (const m of opts.uniqueMentions) {
    const v = opts.mentionEstimates[m.path];
    if (typeof v === 'number' && v > 0) sum += v;
  }
  for (const path of opts.directoryRefs) {
    const v = opts.directoryRefEstimates[path];
    if (typeof v === 'number' && v > 0) sum += v;
  }
  return sum;
}

/**
 * Phase 6 Phase 3 — per-source split of {@link computePendingContextTokens}.
 *
 * Returns the three composer-side pending sub-totals separately so the
 * Context popover can render `files_attachments` and `pending_next_turn`
 * as distinct rows with real numbers. Sums to the same value as
 * computePendingContextTokens when all sources are non-null.
 *
 * Logic mirror of computePendingContextTokens — same null filtering,
 * same iteration order — kept in lockstep so the displayed total never
 * disagrees with the per-source rows.
 */
export interface PendingContextSubTotals {
  /** Attachments queued via PromptInput (file picker / paste / drop). */
  attachment: number;
  /** Explicit `@path` mentions in the input text. */
  mention: number;
  /** Directory references attached via file-tree "+" buttons. */
  directory: number;
}

export function computePendingContextSubTotals(opts: {
  attachmentPendingTokens: number;
  uniqueMentions: ReadonlyArray<MentionRef>;
  mentionEstimates: Readonly<Record<string, number | null | undefined>>;
  directoryRefs: ReadonlyArray<string>;
  directoryRefEstimates: Readonly<Record<string, number | null | undefined>>;
}): PendingContextSubTotals {
  let mention = 0;
  for (const m of opts.uniqueMentions) {
    const v = opts.mentionEstimates[m.path];
    if (typeof v === 'number' && v > 0) mention += v;
  }
  let directory = 0;
  for (const path of opts.directoryRefs) {
    const v = opts.directoryRefEstimates[path];
    if (typeof v === 'number' && v > 0) directory += v;
  }
  return {
    attachment: Math.max(0, opts.attachmentPendingTokens),
    mention,
    directory,
  };
}

// =====================================================================
// Submit payload composition — full handleSubmit assembly as one fn
// =====================================================================

/**
 * Resolved mention payload — output of `resolveMentionPayload()` in
 * MessageInput. Mirrors the shape returned by that helper so a test
 * can construct it without bringing the full hook chain in.
 */
export interface ResolvedMentionPayload {
  mentions: ReadonlyArray<MentionRef>;
  files: ReadonlyArray<FileAttachment>;
  directoryNotes: ReadonlyArray<string>;
  limitNotes: ReadonlyArray<string>;
}

export interface SubmitPayloadInput {
  /** Raw text typed in the textarea (no mention/limit append yet). */
  content: string;
  /** Attachments uploaded via the `+` button (already converted from
   *  base64 form by `convertFiles()`). */
  uploadedFiles: ReadonlyArray<FileAttachment>;
  /** What `resolveMentionPayload()` returned — files inlined from
   *  @mentions, plus directory summaries / over-limit notes. */
  mentionPayload: ResolvedMentionPayload;
  /** Directory paths attached via the file-tree `+` button. */
  directoryRefs: ReadonlyArray<string>;
}

export interface SubmitPayload {
  /** Final ordered file list: uploads → @-mention files → + directories. */
  files: ReadonlyArray<FileAttachment>;
  /** What goes to the model: `content` + mention/limit append, trimmed. */
  finalContent: string;
  /** What goes in the user's message bubble — raw `content` when chips
   *  exist, undefined otherwise (caller falls back to `finalContent`).
   *  Crucial: this NEVER contains `[Referenced Directories]`. */
  displayOverride: string | undefined;
  /** Mentions to send to the backend, or undefined when none. */
  mentions: ReadonlyArray<MentionRef> | undefined;
}

/**
 * Single source of truth for "given pre-submit state, what does the
 * send payload look like and what does the bubble show". Consolidates
 * `buildDirectoryAttachments` + `buildMentionAppend` + `composeFinalContent`
 * + `computeDisplayOverride` into one call so tests can assert the
 * end-to-end submit contract instead of each helper in isolation.
 *
 * MessageInput's normal-path handleSubmit calls this directly; the
 * badge / image-agent branches still go piecewise because they need
 * to mutate `prompt` (badge dispatch result) before composing.
 */
export function composeSubmitPayload(input: SubmitPayloadInput): SubmitPayload {
  const directoryAttachments = buildDirectoryAttachments(input.directoryRefs);
  const files = [
    ...input.uploadedFiles,
    ...input.mentionPayload.files,
    ...directoryAttachments,
  ];
  const mentionAppend = buildMentionAppend(
    input.mentionPayload.directoryNotes,
    input.mentionPayload.limitNotes,
  );
  const finalContent = composeFinalContent(input.content, mentionAppend);
  const hasMentions = input.mentionPayload.mentions.length > 0;
  const hasDirRefs = input.directoryRefs.length > 0;
  return {
    files,
    finalContent,
    displayOverride: computeDisplayOverride(input.content, hasMentions, hasDirRefs),
    mentions: hasMentions ? input.mentionPayload.mentions : undefined,
  };
}
