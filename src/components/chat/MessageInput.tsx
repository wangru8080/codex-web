'use client';

import { useRef, useState, useCallback, useEffect, useMemo, type KeyboardEvent, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ChatStatus } from 'ai';
import type { FileAttachment, MentionRef, PermissionProfile } from '@/types';
import { SlashCommandPopover } from './SlashCommandPopover';
import { FileAwareSubmitButton, FileTreeAttachmentBridge, FileAttachmentsCapsules, ComposerBadgeRow, DirectoryRefsCapsules, AttachmentPendingTracker } from './MessageInputParts';
import { useMentionTokenEstimate } from '@/hooks/useMentionTokenEstimate';
import { dataUrlToFileAttachment } from '@/lib/file-utils';
import { usePopoverState } from '@/hooks/usePopoverState';
import { useProviderModels, isComposerProviderLoading } from '@/hooks/useProviderModels';
import { resolveComposerModelAutoCorrect } from '@/lib/model-option-match';
// Import from `chat-runtime-shared` (client-safe). See ChatView import
// note + `src/lib/chat-runtime-shared.ts` doc-block. Even type-only
// imports from `chat-runtime.ts` are risky if the build leans on
// runtime resolution paths; the shared module is the future-proof
// choice for any client bundle.
import type { ChatRuntimeParam } from '@/lib/chat-runtime-shared';
import { useCommandBadge } from '@/hooks/useCommandBadge';
import { useSlashCommands } from '@/hooks/useSlashCommands';
import {
  resolveKeyAction,
  cycleIndex,
  resolveDirectSlash,
  dispatchBadge,
  parseMentionRefs,
  dedupeMentionsByPath,
  computePendingContextTokens,
  computePendingContextSubTotals,
  type PendingContextSubTotals,
  composeSubmitPayload,
  GOAL_PROMPT_PLACEHOLDER,
  PLAN_PROMPT_PLACEHOLDER,
  goalCommandFromPrompt,
  planPromptFromInput,
} from '@/lib/message-input-logic';
import { QuickActions } from './QuickActions';
import { CaretDown, CaretRight, Check, Gear, X } from '@/components/ui/icon';
import { HandPalm, ListChecks, Paperclip, ShieldCheck, ShieldWarning, Target } from '@phosphor-icons/react';

const MAX_MENTION_FILE_BYTES = 256 * 1024; // 256KB per @file mention
const MAX_MENTION_FILE_COUNT = 6;
const MAX_DIRECTORY_MENTION_COUNT = 3;
const MAX_DIRECTORY_PREVIEW_ITEMS = 30;

/**
 * Abort a composer submit WITHOUT delivering it, preserving the user's text and
 * attachments. PromptInput's submit pipeline clears text/files only when the
 * onSubmit Promise RESOLVES; throwing routes into its rejection branch, which
 * keeps everything — so a blocked / provider-not-ready / gated submit never eats
 * the user's screenshot (#615). Every no-send branch must go through here (or
 * the same throw) instead of a bare `return`, which would resolve and clear.
 */
function abortComposerSubmit(reason: string): never {
  throw new Error(reason);
}

/**
 * sessionStorage key for the per-session composer draft. Exported so the
 * first-message page (page.tsx) can clear it at send-accept: that flow flips
 * the layout (isStreaming) which REMOUNTS the composer, and the remounted
 * MessageInput re-seeds `inputValue` from this draft — so the persisted draft is
 * the one piece of composer state that survives the remount. Clearing it at
 * accept makes the remounted composer come up empty (#4/#5). A new chat has no
 * sessionId → the 'new' bucket.
 */
export const composerDraftKey = (sessionId?: string): string =>
  `codepilot:draft:${sessionId || 'new'}`;

interface MessageInputProps {
  // Returns false when the submit was NOT accepted for delivery (provider still
  // loading / no compatible provider / runtime-incompatible). The composer then
  // preserves the user's text + attachments. true / void means accepted — either
  // sent or queued — so the composer clears. (#615 screenshot-eaten fix)
  onSend: (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string, mentions?: MentionRef[], selectedSkills?: readonly string[], modeOverride?: string) => boolean | void | Promise<boolean | void>;
  onCommand?: (command: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  sessionId?: string;
  modelName?: string;
  onModelChange?: (model: string) => void;
  providerId?: string;
  permissionProfile?: PermissionProfile;
  onPermissionChange?: (profile: PermissionProfile) => void | Promise<void>;
  /**
   * Phase 6 P0 (2026-05-15) — `opts.isAuto` differentiates the
   * MessageInput auto-correct fallback (model→firstCompatibleModel
   * when the user's saved model isn't reachable under the active
   * runtime) from a manual user pick in the dropdown. Manual picks
   * are the only path that should clear `invalidDefault` /
   * `noCompatibleProvider`, write to localStorage as the new
   * "recently used", or PATCH the session row. Auto-correct just
   * synchronises display state.
   */
  onProviderModelChange?: (
    providerId: string,
    model: string,
    opts?: { isAuto?: boolean },
  ) => void;
  workingDirectory?: string;
  onAssistantTrigger?: () => void;
  /** Effort selection lifted to parent for inclusion in the stream chain */
  effort?: string;
  onEffortChange?: (effort: string | undefined) => void;
  /** SDK init metadata — when available, used to validate command/skill availability */
  sdkInitMeta?: { tools?: unknown; slash_commands?: unknown; skills?: unknown } | null;
  /** Initial value to prefill in the input */
  initialValue?: string;
  /** Whether this session is an assistant workspace project */
  isAssistantProject?: boolean;
  /** Whether the session already has messages */
  hasMessages?: boolean;
  /** Notify parent when the total estimated tokens of currently
   *  attached @ mention chips changes. Used to surface "+10K 待加"
   *  in the Run status panel before the message is sent. */
  onPendingContextTokensChange?: (tokens: number) => void;
  /** Phase 6 Phase 3 — per-source split of the same number. When wired
   *  on the parent, flows through to useContextUsage so the popover's
   *  pending kinds (files_attachments) render real per-source breakdowns.
   *  Independent from onPendingContextTokensChange — parents may listen
   *  to either or both. */
  onPendingContextSubTotalsChange?: (subTotals: PendingContextSubTotals) => void;
  onModeChange?: (mode: string) => void;
  modeChangeDisabled?: boolean;
  /**
   * Round 2 — Run Checkpoint blocking. When non-empty, handleSubmit
   * silently no-ops (the active banner already explains why and
   * carries the confirm-and-send button). Bypassed by the
   * `run-checkpoint-confirm-send` window event so the page can
   * trigger send from the banner without flipping this prop first.
   */
  blockingReasonIds?: ReadonlyArray<string>;
  /**
   * Phase 2 Step 3b — runtime gate for the picker feed.
   *   - `'auto'`: new chat, follow global `agent_runtime`.
   *   - `'claude_code'` / `'codepilot_runtime'`: existing session with
   *     a `runtime_pin` — picker shows only what THIS session can
   *     reach, immune to global flips.
   * Required (no default) so a new caller can't silently inherit the
   * old "auto = follow global, drift on flip" behavior.
   */
  runtime: ChatRuntimeParam;
  /** Codex-only Web 收缩：新建聊天只读取 Codex 账户模型。 */
  codexOnly?: boolean;
}

function ComposerPlusMenuItem({
  icon,
  label,
  description,
  onSelect,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  onSelect?: (event: Event) => void;
  disabled?: boolean;
}) {
  return (
    <PromptInputActionMenuItem
      disabled={disabled}
      onSelect={onSelect}
      className="min-h-10 items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-foreground">{label}</span>
        {description && (
          <span className="truncate text-sm font-normal text-muted-foreground/55">
            {description}
          </span>
        )}
      </span>
    </PromptInputActionMenuItem>
  );
}

function FileAndFolderMenuItem() {
  const attachments = usePromptInputAttachments();

  const handleSelect = useCallback(
    (event: Event) => {
      event.preventDefault();
      attachments.openFileDialog();
    },
    [attachments],
  );

  return (
    <ComposerPlusMenuItem
      icon={<Paperclip size={20} />}
      label="文件和文件夹"
      onSelect={handleSelect}
    />
  );
}

function GoalPromptModePill({ onCancel }: { onCancel: () => void }) {
  return (
    <span className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-muted/60 px-2.5 text-sm font-medium text-muted-foreground">
      <Target size={18} />
      <span>目标</span>
      <button
        type="button"
        aria-label="取消目标"
        onClick={onCancel}
        className="pointer-events-auto ml-0.5 rounded p-0.5 text-muted-foreground/70 hover:bg-background/80 hover:text-foreground"
      >
        <X size={12} />
      </button>
    </span>
  );
}

function PlanPromptModePill({ onCancel }: { onCancel: () => void }) {
  return (
    <span className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-muted/60 px-2.5 text-sm font-medium text-muted-foreground">
      <ListChecks size={18} />
      <span>计划</span>
      <button
        type="button"
        aria-label="取消计划"
        onClick={onCancel}
        className="pointer-events-auto ml-0.5 rounded p-0.5 text-muted-foreground/70 hover:bg-background/80 hover:text-foreground"
      >
        <X size={12} />
      </button>
    </span>
  );
}

type PermissionChoice = {
  id: Extract<PermissionProfile, 'request_approval' | 'auto_approval' | 'full_access' | 'config'>;
  label: string;
  description: string;
  profile: PermissionProfile;
  icon: ReactNode;
};

function normalizePermissionProfile(profile?: PermissionProfile): PermissionChoice['id'] {
  if (profile === 'auto_approval' || profile === 'full_access' || profile === 'config') {
    return profile;
  }
  return 'request_approval';
}

function ComposerPermissionSelector({
  permissionProfile = 'request_approval',
  onPermissionChange,
  disabled,
}: {
  permissionProfile?: PermissionProfile;
  onPermissionChange?: (profile: PermissionProfile) => void | Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [localChoice, setLocalChoice] = useState<PermissionChoice['id']>('request_approval');
  const [showWarning, setShowWarning] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<PermissionChoice['id'] | null>(null);

  const choices: PermissionChoice[] = useMemo(() => [
    {
      id: 'request_approval',
      label: '请求批准',
      description: '编辑外部文件和使用互联网时始终询问',
      profile: 'request_approval',
      icon: <HandPalm size={20} />,
    },
    {
      id: 'auto_approval',
      label: '替我审批',
      description: '仅对检测到的风险操作请求批准',
      profile: 'auto_approval',
      icon: <ShieldCheck size={20} />,
    },
    {
      id: 'full_access',
      label: '完全访问权限',
      description: '可不受限制地访问互联网和您电脑上的任何文件',
      profile: 'full_access',
      icon: <ShieldWarning size={20} />,
    },
    {
      id: 'config',
      label: '自定义（config.toml）',
      description: '使用 config.toml 中定义的权限',
      profile: 'config',
      icon: <Gear size={20} />,
    },
  ], []);

  const activeChoiceId = normalizePermissionProfile(permissionProfile) || localChoice;
  const activeChoice = choices.find((choice) => choice.id === activeChoiceId) ?? choices[0];

  const applyChoice = useCallback(async (choice: PermissionChoice) => {
    try {
      await onPermissionChange?.(choice.profile);
      setLocalChoice(choice.id);
    } catch (error) {
      console.warn('[ComposerPermissionSelector] 权限更新失败:', error);
    }
  }, [onPermissionChange]);

  const handleSelect = useCallback((choice: PermissionChoice) => {
    if (disabled || !onPermissionChange) return;
    if (choice.profile === 'full_access' && permissionProfile !== 'full_access') {
      setPendingChoice(choice.id);
      setShowWarning(true);
      return;
    }
    void applyChoice(choice);
  }, [applyChoice, disabled, onPermissionChange, permissionProfile]);

  const confirmFullAccess = useCallback(() => {
    const choice = choices.find((item) => item.id === pendingChoice);
    setShowWarning(false);
    setPendingChoice(null);
    if (choice) void applyChoice(choice);
  }, [applyChoice, choices, pendingChoice]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PromptInputButton disabled={disabled || !onPermissionChange} className="gap-1.5 px-2">
            <span className="text-muted-foreground">{activeChoice.icon}</span>
            <span className="text-sm font-medium">{activeChoice.label}</span>
            <CaretDown size={12} className="text-muted-foreground" />
          </PromptInputButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[420px] max-w-[calc(100vw-2rem)] rounded-xl p-1.5">
          {choices.map((choice) => (
            <DropdownMenuItem
              key={choice.id}
              disabled={disabled || !onPermissionChange}
              onSelect={() => handleSelect(choice)}
              className="min-h-12 items-center gap-3 rounded-lg px-3 py-2"
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                {choice.icon}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-semibold leading-tight text-foreground">{choice.label}</span>
                <span className="truncate text-sm font-normal leading-tight text-muted-foreground/65">
                  {choice.description}
                </span>
              </span>
              {activeChoiceId === choice.id && (
                <Check size={18} className="shrink-0 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showWarning} onOpenChange={setShowWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>完全访问权限</AlertDialogTitle>
            <AlertDialogDescription>
              {t('permission.fullAccessWarning' as TranslationKey)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmFullAccess}
            >
              完全访问权限
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type ComposerModelOption = {
  value: string;
  label: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
};

const EFFORT_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '超高' },
] as const;

function displayModelShortLabel(label: string): string {
  const cleaned = label.replace(/^gpt[-\s]?/i, '').replace(/^GPT[-\s]?/, '');
  return cleaned || label;
}

function ComposerReasoningModelSelector({
  selectedEffort,
  onEffortChange,
  currentModelOption,
  currentModelValue,
  currentProviderIdValue,
  modelOptions,
  onModelChange,
  onProviderModelChange,
  persistLastModel,
  disabled,
}: {
  selectedEffort: string;
  onEffortChange: (effort: string) => void;
  currentModelOption?: ComposerModelOption;
  currentModelValue: string;
  currentProviderIdValue: string;
  modelOptions: ComposerModelOption[];
  onModelChange?: (model: string) => void;
  onProviderModelChange?: (
    providerId: string,
    model: string,
    opts?: { isAuto?: boolean },
  ) => void;
  persistLastModel: boolean;
  disabled?: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const effectiveEffort = selectedEffort === 'auto' ? 'high' : selectedEffort;
  const effortLabel = EFFORT_OPTIONS.find((item) => item.value === effectiveEffort)?.label ?? '高';
  const modelLabel = currentModelOption?.label || currentModelValue || modelOptions[0]?.label || '';
  const modelShortLabel = displayModelShortLabel(modelLabel);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleEffortSelect = useCallback((effort: string) => {
    onEffortChange(effort);
    setOpen(false);
    setModelMenuOpen(false);
  }, [onEffortChange]);

  const handleModelSelect = useCallback((option: ComposerModelOption) => {
    const providerId = currentProviderIdValue;
    const modelValue = option.value;
    onModelChange?.(modelValue);
    onProviderModelChange?.(providerId, modelValue);
    if (persistLastModel) {
      try {
        localStorage.setItem('codepilot:last-model', modelValue);
        localStorage.setItem('codepilot:last-provider-id', providerId);
      } catch {
        // 忽略浏览器存储失败；选择本身仍然通过 React 状态生效。
      }
    }
    setOpen(false);
    setModelMenuOpen(false);
  }, [currentProviderIdValue, onModelChange, onProviderModelChange, persistLastModel]);

  const isModelActive = useCallback((option: ComposerModelOption) => (
    option.value === currentModelOption?.value || option.value === currentModelValue
  ), [currentModelOption?.value, currentModelValue]);

  return (
    <div className="relative" ref={menuRef}>
      <PromptInputButton
        disabled={disabled}
        onClick={() => {
          setOpen((prev) => !prev);
          setModelMenuOpen(false);
        }}
        className="gap-1.5 px-2"
      >
        <span className="text-sm font-medium">{modelShortLabel}</span>
        <span className="text-sm font-medium text-muted-foreground">{effortLabel}</span>
        <CaretDown size={12} className="text-muted-foreground" />
      </PromptInputButton>

      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-[260px] rounded-2xl border bg-popover p-1.5 shadow-[var(--shadow-diffuse)]">
          <div className="px-2.5 pb-1.5 pt-1 text-xs font-semibold text-muted-foreground/65">推理</div>
          <div className="space-y-0.5">
            {EFFORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  'flex h-9 w-full items-center rounded-lg px-2.5 text-left text-sm font-semibold text-foreground hover:bg-accent',
                  effectiveEffort === option.value && 'bg-accent',
                )}
                onClick={() => handleEffortSelect(option.value)}
              >
                <span>{option.label}</span>
                {effectiveEffort === option.value && (
                  <Check size={18} className="ml-auto text-muted-foreground" />
                )}
              </button>
            ))}
          </div>
          <div className="my-1.5 h-px bg-border" />
          <button
            type="button"
            className="flex h-9 w-full items-center rounded-lg bg-accent px-2.5 text-left text-sm font-normal text-foreground hover:bg-accent"
            onMouseEnter={() => setModelMenuOpen(true)}
            onClick={() => setModelMenuOpen(true)}
          >
            <span>{modelLabel}</span>
            <CaretRight size={18} className="ml-auto text-muted-foreground" />
          </button>

          {modelMenuOpen && (
            <div
              className="absolute bottom-0 left-[calc(100%+8px)] z-50 w-[260px] rounded-2xl border bg-popover p-3 shadow-[var(--shadow-diffuse)]"
              onMouseEnter={() => setModelMenuOpen(true)}
            >
              <div className="mb-2 text-xs font-semibold text-muted-foreground/65">模型</div>
              <div className="space-y-1">
                {modelOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="flex h-9 w-full items-center rounded-lg px-2 text-left text-sm font-normal text-foreground hover:bg-accent"
                    onClick={() => handleModelSelect(option)}
                  >
                    <span>{option.label}</span>
                    {isModelActive(option) && (
                      <Check size={18} className="ml-auto text-muted-foreground" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function joinPath(base: string, rel: string): string {
  const b = base.replace(/[\\/]+$/, '');
  const r = rel.replace(/^[\\/]+/, '');
  return `${b}/${r}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fileResponseToAttachment(
  response: Response,
  filename: string,
  idPrefix: string,
  originPath?: string,
): Promise<FileAttachment> {
  const mimeType = response.headers.get('content-type') || 'application/octet-stream';
  const buffer = await response.arrayBuffer();
  return {
    id: `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: filename,
    type: mimeType,
    size: buffer.byteLength,
    data: arrayBufferToBase64(buffer),
    // #628 — preserve the real in-tree path for @-mentions so the chat route can
    // reference the user's actual file instead of a `.codepilot-uploads` copy.
    ...(originPath ? { originPath } : {}),
  };
}

export function MessageInput({
  onSend,
  onCommand,
  onStop,
  disabled,
  isStreaming,
  sessionId,
  modelName,
  onModelChange,
  providerId,
  permissionProfile,
  onPermissionChange,
  onProviderModelChange,
  workingDirectory,
  onAssistantTrigger,
  runtime,
  effort: effortProp,
  onEffortChange,
  sdkInitMeta,
  initialValue,
  isAssistantProject,
  hasMessages,
  onPendingContextTokensChange,
  onPendingContextSubTotalsChange,
  onModeChange,
  modeChangeDisabled,
  blockingReasonIds,
  codexOnly,
}: MessageInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Run Checkpoint bypass — Round 2 (2026-04-30). When the banner's
  // confirm action fires (via the `run-checkpoint-confirm-send` window
  // event), we set this ref true synchronously, then programmatically
  // re-trigger the submit button. handleSubmit reads + clears the ref
  // on each call so the bypass only applies to the immediately-next
  // submission.
  const bypassBlockingRef = useRef(false);
  // Persist draft per session so switching chats doesn't lose typed text.
  const draftKey = composerDraftKey(sessionId);
  const [inputValue, setInputValueRaw] = useState(() => {
    if (initialValue) return initialValue;
    try { return sessionStorage.getItem(draftKey) || ''; } catch { return ''; }
  });
  const [goalPromptActive, setGoalPromptActive] = useState(false);
  const [planPromptActive, setPlanPromptActive] = useState(false);
  // Track the last `initialValue` we've reconciled so the warm-navigation
  // sync below fires only when the prop ACTUALLY transitions (not on every
  // render where it's stable). State (not a ref) so the reconcile can run
  // during render — reading a ref during render is itself a React Compiler
  // bailout. Initialised to the mount-time `initialValue`, so the first
  // render is a no-op and we don't double-set inputValue.
  const [seenInitialValue, setSeenInitialValue] = useState(initialValue);
  const [mentionNodeTypes, setMentionNodeTypes] = useState<Record<string, 'file' | 'directory'>>({});
  // Directories attached via the file tree's "+" button. Kept separate
  // from textarea-driven `@folder` mentions so the chip lives in the
  // green-capsule attachment row (visual parity with file/image
  // attachments) instead of writing `@path/` text into the textarea.
  const [directoryRefs, setDirectoryRefs] = useState<string[]>([]);
  const [badgeOrder, setBadgeOrder] = useState<Record<string, number>>({});
  const [mentionOrder, setMentionOrder] = useState<Record<string, number>>({});
  const orderSeqRef = useRef(0);
  const setInputValue = useCallback((v: string | ((prev: string) => string)) => {
    setInputValueRaw((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      try { if (next) sessionStorage.setItem(draftKey, next); else sessionStorage.removeItem(draftKey); } catch { /* quota */ }
      return next;
    });
  }, [draftKey]);

  // Warm-navigation prefill sync. The `useState` initialiser above only
  // runs at mount — if `initialValue` arrives later (e.g. /chat is already
  // mounted and the URL changes to /chat?prefill=…, or the parent reads URL
  // via `useSearchParams` after first paint), the textarea would otherwise
  // stay empty. React's "adjust state when a prop changes" pattern (render
  // time, not an effect — https://react.dev/learn/you-might-not-need-an-effect):
  // when `initialValue` transitions to a new value we adopt it; when it goes
  // back to empty we just record the transition so a later re-arrival of the
  // same prefill text counts as fresh. `setInputValueRaw` (not setInputValue)
  // because we're mid-render — the persisted-draft write happens on the next
  // user keystroke, and a URL prefill is re-derivable from the URL anyway.
  if (initialValue !== seenInitialValue) {
    setSeenInitialValue(initialValue);
    if (initialValue) {
      setInputValueRaw(initialValue);
    }
  }

  // Phase 4 — `codepilot:add-to-chat` listener. Selection from
  // PreviewPanel dispatches a window event with the selected text +
  // source metadata; we wrap the quote in a markdown blockquote and
  // append a provenance line so the AI sees both content and source.
  // The composer treats it as a normal prefill — the user can still
  // edit before sending, and badge / mention parsing kicks in
  // naturally because the appended content is plain text.
  useEffect(() => {
    function handle(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (!detail || typeof detail !== 'object') return;
      const d = detail as { text?: unknown; sourcePath?: unknown; sourceAnchor?: unknown; sourceLabel?: unknown };
      if (typeof d.text !== 'string' || typeof d.sourcePath !== 'string') return;
      const provenance =
        '> [来源] ' +
        d.sourcePath +
        (typeof d.sourceAnchor === 'string' ? d.sourceAnchor : '') +
        (typeof d.sourceLabel === 'string' ? ' — ' + d.sourceLabel : '');
      const quote = d.text
        .split(/\r?\n/)
        .map((l) => '> ' + l)
        .join('\n');
      const composed = `${provenance}\n${quote}\n\n`;
      setInputValue((prev) => (prev ? `${prev}\n\n${composed}` : composed));
    }
    window.addEventListener('codepilot:add-to-chat', handle);
    return () => window.removeEventListener('codepilot:add-to-chat', handle);
  }, [setInputValue]);

  const mentions = useMemo(() => {
    // Render chips only for explicitly inserted/known mentions.
    return parseMentionRefs(inputValue, mentionNodeTypes).filter((m) => !!mentionNodeTypes[m.path]);
  }, [inputValue, mentionNodeTypes]);

  const nextOrder = useCallback(() => {
    orderSeqRef.current += 1;
    return orderSeqRef.current;
  }, []);

  const ensureBadgeOrder = useCallback((command: string) => {
    setBadgeOrder((prev) => {
      if (prev[command]) return prev;
      return { ...prev, [command]: nextOrder() };
    });
  }, [nextOrder]);

  const ensureMentionOrder = useCallback((path: string) => {
    setMentionOrder((prev) => {
      if (prev[path]) return prev;
      return { ...prev, [path]: nextOrder() };
    });
  }, [nextOrder]);

  // --- Extracted hooks ---
  const popover = usePopoverState(modelName);
  const { providerGroups, currentProviderIdValue, modelOptions, currentModelOption, fetchState } = useProviderModels(providerId, modelName, runtime, { codexOnly });
  // P0.4 — only show "正在准备运行环境…" during the genuine first load, not
  // on a background refetch when a sendable model is already resolved.
  const isProviderLoading = isComposerProviderLoading(fetchState, !!currentModelOption);

  // Auto-correct model when it doesn't exist in the current provider's model list.
  // This prevents sending an unsupported model name (e.g. 'opus' to MiniMax which only has 'sonnet').
  // IMPORTANT: Only fall back to first model — never use globalDefaultModel here.
  // Global default model is only for NEW conversations (chat/page.tsx).
  // Existing sessions must keep their own selected model; if that model becomes
  // invalid (provider changed), fall back to the provider's first model, not the
  // global default, to avoid overwriting the session's model choice.
  //
  // Phase 6 P0 (2026-05-15) — pass `{ isAuto: true }` so the parent's
  // handler doesn't treat this as a manual user pick. A silent
  // auto-correct must NOT clear `invalidDefault` /
  // `noCompatibleProvider`, write `codepilot:last-model` /
  // `codepilot:last-provider-id` localStorage as the new "recently
  // used", or PATCH the session row. It just synchronises display
  // state so the picker label and the runtime-compatible fallback
  // pair (provider, model) agree.
  useEffect(() => {
    // Canonical-aware auto-correct (tech-debt #37). The decision lives in a pure,
    // unit-tested helper: a model that resolves by value OR canonical upstream is
    // NOT corrected (the old value-only check rewrote canonical ids like
    // `claude-opus-4-7` to the first model (Sonnet), which fed `useProviderModels`
    // and made the send path send Sonnet). Only correct genuinely-absent models.
    const fallback = resolveComposerModelAutoCorrect(modelName, modelOptions);
    if (fallback !== null) {
      onModelChange?.(fallback);
      onProviderModelChange?.(currentProviderIdValue, fallback, { isAuto: true });
    }
  }, [modelName, modelOptions, currentProviderIdValue, onModelChange, onProviderModelChange]);

  const { badges, addBadge, removeBadge, clearBadges, hasBadge } = useCommandBadge(textareaRef);
  const addBadgeWithOrder = useCallback((badge: { command: string; label: string; description: string; kind: 'agent_skill' | 'slash_command' | 'sdk_command' | 'codepilot_command'; installedSource?: 'agents' | 'claude' }) => {
    ensureBadgeOrder(badge.command);
    addBadge(badge);
  }, [addBadge, ensureBadgeOrder]);
  const removeBadgeWithOrder = useCallback((command: string) => {
    removeBadge(command);
    setBadgeOrder((prev) => {
      if (!prev[command]) return prev;
      const next = { ...prev };
      delete next[command];
      return next;
    });
  }, [removeBadge]);
  const clearBadgesWithOrder = useCallback(() => {
    clearBadges();
    setBadgeOrder({});
  }, [clearBadges]);

  const activateGoalPrompt = useCallback(() => {
    clearBadgesWithOrder();
    popover.closePopover();
    setPlanPromptActive(false);
    setGoalPromptActive(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [clearBadgesWithOrder, popover]);

  const cancelGoalPrompt = useCallback(() => {
    setGoalPromptActive(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const activatePlanPrompt = useCallback(() => {
    clearBadgesWithOrder();
    popover.closePopover();
    setGoalPromptActive(false);
    setPlanPromptActive(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [clearBadgesWithOrder, popover]);

  const cancelPlanPrompt = useCallback(() => {
    setPlanPromptActive(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  // Live refs to badge state so the gated-send restore in handleSubmit
  // reads the CURRENT value and never clobbers a badge the user picked during an
  // async failure window (Codex P3). Text + dirs use functional updaters for the
  // same guard; badges have no functional-update setter, so a ref is the
  // equivalent.
  const badgesRef = useRef(badges);
  useEffect(() => {
    badgesRef.current = badges;
  }, [badges]);

  const slashCommands = useSlashCommands({
    sessionId,
    workingDirectory,
    sdkInitMeta,
    textareaRef,
    inputValue,
    setInputValue,
    popoverMode: popover.popoverMode,
    popoverFilter: popover.popoverFilter,
    triggerPos: popover.triggerPos,
    setPopoverMode: popover.setPopoverMode,
    setPopoverFilter: popover.setPopoverFilter,
    setPopoverItems: popover.setPopoverItems,
    setSelectedIndex: popover.setSelectedIndex,
    setTriggerPos: popover.setTriggerPos,
    closePopover: popover.closePopover,
    onCommand,
    addBadge: addBadgeWithOrder,
    onMentionInserted: (mention) => {
      setMentionNodeTypes((prev) => ({ ...prev, [mention.path]: mention.nodeType }));
      ensureMentionOrder(mention.path);
    },
    isStreaming: !!isStreaming,
  });

  // Assistant trigger on first focus
  const assistantTriggerFired = useRef(false);
  const handleAssistantFocus = useCallback(() => {
    if (!assistantTriggerFired.current && onAssistantTrigger) {
      assistantTriggerFired.current = true;
      onAssistantTrigger();
    }
  }, [onAssistantTrigger]);

  // Listen for file tree "+" button and drop-router: insert @path into the
  // textarea. `nodeType` defaults to 'file' so older callers still work; when
  // it's 'directory', the difference is stored in mentionNodeTypes (not in the
  // text token) to match the picker's convention (see resolveItemSelection).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string; nodeType?: 'file' | 'directory' }>).detail;
      const rawPath = detail?.path;
      if (!rawPath) return;
      const normalizedPath = rawPath.replace(/\/+$/, '');
      if (!normalizedPath) return;
      const nodeType = detail.nodeType ?? 'file';
      setMentionNodeTypes((prev) => ({ ...prev, [normalizedPath]: nodeType }));
      ensureMentionOrder(normalizedPath);
      setInputValue((prev) => {
        const needsSpace = prev.length > 0 && !prev.endsWith(' ') && !prev.endsWith('\n');
        return prev + (needsSpace ? ' ' : '') + `@${normalizedPath} `;
      });
      setTimeout(() => textareaRef.current?.focus(), 0);
    };
    window.addEventListener('insert-file-mention', handler);
    return () => window.removeEventListener('insert-file-mention', handler);
  }, [setInputValue, setMentionNodeTypes, ensureMentionOrder]);

  const normalizeMentionPath = useCallback((rawPath: string): string => {
    const normalizedRaw = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!workingDirectory) return normalizedRaw;
    const normalizedBase = workingDirectory.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalizedRaw.startsWith(normalizedBase + '/')) {
      return normalizedRaw.slice(normalizedBase.length + 1);
    }
    return normalizedRaw;
  }, [workingDirectory]);

  const fetchMentionFileAttachment = useCallback(async (mentionPath: string): Promise<{ attachment: FileAttachment | null; limitNote?: string }> => {
    const safePath = normalizeMentionPath(mentionPath);
    const filename = safePath.split('/').filter(Boolean).pop() || 'file';
    try {
      if (sessionId) {
        const res = await fetch(`/api/files/serve?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(safePath)}`);
        if (!res.ok) return { attachment: null };
        const headerSize = Number.parseInt(res.headers.get('content-length') || '', 10);
        if (Number.isFinite(headerSize) && headerSize > MAX_MENTION_FILE_BYTES) {
          return { attachment: null, limitNote: `@${safePath}: omitted (file too large > 256KB).` };
        }
        const attachment = await fileResponseToAttachment(res, filename, 'mention', safePath);
        if (attachment.size > MAX_MENTION_FILE_BYTES) {
          return { attachment: null, limitNote: `@${safePath}: omitted (file too large > 256KB).` };
        }
        return { attachment };
      }

      if (!workingDirectory) return { attachment: null };
      const absolutePath = joinPath(workingDirectory, safePath);
      const res = await fetch(`/api/files/raw?path=${encodeURIComponent(absolutePath)}`);
      if (!res.ok) return { attachment: null };
      const headerSize = Number.parseInt(res.headers.get('content-length') || '', 10);
      if (Number.isFinite(headerSize) && headerSize > MAX_MENTION_FILE_BYTES) {
        return { attachment: null, limitNote: `@${safePath}: omitted (file too large > 256KB).` };
      }
      const attachment = await fileResponseToAttachment(res, filename, 'mention', safePath);
      if (attachment.size > MAX_MENTION_FILE_BYTES) {
        return { attachment: null, limitNote: `@${safePath}: omitted (file too large > 256KB).` };
      }
      return { attachment };
    } catch {
      return { attachment: null };
    }
  }, [sessionId, workingDirectory, normalizeMentionPath]);

  const fetchDirectorySummary = useCallback(async (mentionPath: string): Promise<string | null> => {
    if (!workingDirectory) return null;
    const safePath = normalizeMentionPath(mentionPath);
    const dir = joinPath(workingDirectory, safePath);
    try {
      const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}&baseDir=${encodeURIComponent(workingDirectory)}&depth=2`);
      if (!res.ok) return null;
      const data = await res.json();
      const tree = Array.isArray(data.tree) ? data.tree : [];
      const preview = tree.slice(0, MAX_DIRECTORY_PREVIEW_ITEMS).map((node: { name: string; type: 'file' | 'directory' }) => (
        node.type === 'directory' ? `- ${node.name}/` : `- ${node.name}`
      ));
      const extra = tree.length > MAX_DIRECTORY_PREVIEW_ITEMS
        ? `\n- ... (${tree.length - MAX_DIRECTORY_PREVIEW_ITEMS} more)`
        : '';
      return `Directory reference @${safePath}/\n${preview.join('\n')}${extra}`;
    } catch {
      return null;
    }
  }, [workingDirectory, normalizeMentionPath]);

  const handleSubmit = useCallback(async (msg: { text: string; files: Array<{ type: string; url: string; filename?: string; mediaType?: string }> }, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Run Checkpoint blocking — Round 2. When the page reports any
    // active reason that requires confirmation, the send is silently
    // dropped here. The visible RunCheckpoint banner above the
    // composer carries the "确认并发送" action; clicking it sets
    // `bypassBlockingRef` and re-triggers this submit, so the same
    // user-edited content + attachments flow through unchanged.
    if (!bypassBlockingRef.current && blockingReasonIds && blockingReasonIds.length > 0) {
      // Reject instead of resolving: PromptInput clears text/files only
      // after a successful submit. The checkpoint banner already explains
      // the block, so this preserves screenshots until confirm-and-send.
      abortComposerSubmit('run-checkpoint-blocked');
    }
    bypassBlockingRef.current = false;

    const content = inputValue.trim();

    popover.closePopover();

    if (goalPromptActive) {
      const goalCommand = goalCommandFromPrompt(content);
      if (!goalCommand) return;
      if (disabled) abortComposerSubmit('composer-disabled');
      if (isStreaming) abortComposerSubmit('composer-goal-streaming');
      if (!onCommand) abortComposerSubmit('composer-goal-command-unavailable');
      setInputValue('');
      setGoalPromptActive(false);
      onCommand(goalCommand);
      return;
    }

    if (planPromptActive) {
      const planPrompt = planPromptFromInput(content);
      if (!planPrompt) return;
      if (disabled) abortComposerSubmit('composer-disabled');
      if (isStreaming) abortComposerSubmit('composer-plan-streaming');
      if (!onModeChange) abortComposerSubmit('composer-plan-mode-unavailable');
      onModeChange('plan');
      const accepted = await onSend(planPrompt, undefined, undefined, undefined, undefined, undefined, 'plan');
      if (accepted === false) abortComposerSubmit('composer-plan-not-accepted');
      setInputValue('');
      setPlanPromptActive(false);
      return;
    }

    // Convert PromptInput FileUIParts (with data URLs) to FileAttachment[]
    const convertFiles = async (): Promise<FileAttachment[]> => {
      if (!msg.files || msg.files.length === 0) return [];

      const attachments: FileAttachment[] = [];
      for (const file of msg.files) {
        if (!file.url) continue;
        try {
          const attachment = await dataUrlToFileAttachment(
            file.url,
            file.filename || 'file',
            file.mediaType || 'application/octet-stream',
          );
          attachments.push(attachment);
        } catch {
          // Skip files that fail conversion
        }
      }
      return attachments;
    };

    const resolveMentionPayload = async () => {
      // Only treat mentions inserted/confirmed by the picker (or file-tree bridge)
      // as structured mentions. Plain typed "@foo" should remain plain text.
      const parsedMentions = parseMentionRefs(inputValue, mentionNodeTypes)
        .filter((m) => !!mentionNodeTypes[m.path]);
      const dedupedMentions = dedupeMentionsByPath(parsedMentions);

      const mentionFiles: FileAttachment[] = [];
      const directoryNotes: string[] = [];
      const limitNotes: string[] = [];
      let usedDirectoryMentions = 0;
      for (const mention of dedupedMentions) {
        if (mention.nodeType === 'directory') {
          if (usedDirectoryMentions >= MAX_DIRECTORY_MENTION_COUNT) {
            limitNotes.push(`@${mention.path}/: omitted (max ${MAX_DIRECTORY_MENTION_COUNT} directories per message).`);
            continue;
          }
          const summary = await fetchDirectorySummary(mention.path);
          if (summary) directoryNotes.push(summary);
          usedDirectoryMentions += 1;
          continue;
        }
        if (mentionFiles.length >= MAX_MENTION_FILE_COUNT) {
          limitNotes.push(`@${mention.path}: omitted (max ${MAX_MENTION_FILE_COUNT} files per message).`);
          continue;
        }
        const { attachment, limitNote } = await fetchMentionFileAttachment(mention.path);
        if (attachment) mentionFiles.push(attachment);
        if (limitNote) limitNotes.push(limitNote);
      }

      // Merge in directories the user attached via the file-tree "+" —
      // they don't appear in `dedupedMentions` because they're tracked
      // outside the textarea. Same MAX_DIRECTORY_MENTION_COUNT cap
      // applies across both sources combined.
      for (const path of directoryRefs) {
        if (usedDirectoryMentions >= MAX_DIRECTORY_MENTION_COUNT) {
          limitNotes.push(`${path}/: omitted (max ${MAX_DIRECTORY_MENTION_COUNT} directories per message).`);
          continue;
        }
        const summary = await fetchDirectorySummary(path);
        if (summary) directoryNotes.push(summary);
        usedDirectoryMentions += 1;
      }

      return { mentions: dedupedMentions, files: mentionFiles, directoryNotes, limitNotes };
    };

    // If one or more badges are active, dispatch by kind (multi-skill combines).
    // Block during streaming — badges carry slash/skill semantics, not safe to queue.
    if (badges.length > 0) {
      // No-send: badges carry slash/skill semantics, not safe to queue during
      // streaming. Preserve the composer (text + badges + attachments) instead
      // of letting PromptInput clear them (#615).
      if (isStreaming) abortComposerSubmit('composer-badge-streaming');
      const uploadedFiles = await convertFiles();
      const mentionPayload = await resolveMentionPayload();
      const { prompt, displayLabel } = dispatchBadge(badges, content);
      // Codex review v3 P1 fix (2026-05-20) — extract agent_skill badge
      // labels as a structured channel for Context Accounting Phase 2.
      // Codex v5 P1 fix (2026-05-20) — canonicalize before passing.
      // Inline (NOT importing canonicalizeSkillName from
      // claude-code-context-accounting): that module pulls
      // discoverSkills → `node:fs`, which Next.js Turbopack drags into
      // the client bundle through this import — produced "Module not
      // found: 'fs'" 500 on /chat. Keeping canonicalize inline here is
      // client-safe; the producer module has its own copy defensively
      // (intentional duplication for boundary safety).
      const canonicalizeSkillNameInline = (v: string) =>
        v.trim().replace(/^\/+/, '');
      const selectedSkills = badges
        .filter((b) => b.kind === 'agent_skill')
        .map((b) => canonicalizeSkillNameInline(b.command || b.label))
        .filter((n) => n.length > 0);
      // Badge path: `prompt` (dispatchBadge output) takes the content slot
      // for the model side, but the bubble's `displayLabel` is owned by the
      // badge dispatcher (e.g. "/agent\nuser context"), not the chip-aware
      // displayOverride. So we use composeSubmitPayload for files +
      // finalContent + mentions, and substitute displayLabel for the bubble.
      const payload = composeSubmitPayload({
        content: prompt,
        uploadedFiles,
        mentionPayload,
        directoryRefs,
      });
      const { files, finalContent: finalPrompt } = payload;
      // Clear OPTIMISTICALLY before awaiting delivery (same rationale as the
      // normal path below): the first-message send doesn't resolve until the
      // stream ends and the composer no longer remounts (#615), so a post-await
      // clear left the sent text + skill/slash badges sitting in the box for the
      // whole turn (Codex P2 — the badge path had the same lingering bug).
      const restoreInput = inputValue;
      const restoreDirs = [...directoryRefs];
      const restoreBadges = [...badges];
      clearBadgesWithOrder();
      setInputValue('');
      setDirectoryRefs([]);
      const delivered = await onSend(
        finalPrompt,
        files.length > 0 ? files.slice() : undefined,
        undefined,
        displayLabel,
        payload.mentions ? [...payload.mentions] : undefined,
        selectedSkills.length > 0 ? selectedSkills : undefined,
      );
      if (delivered === false) {
        // Gated/no-op send — restore, guarded so a new message the user started
        // during the failure window isn't clobbered (Codex P2/P3). Re-add the
        // cleared badges only if the user hasn't picked a new one since (the live
        // ref reads the CURRENT badges, not this stale send-closure).
        setInputValue((cur) => (cur ? cur : restoreInput));
        setDirectoryRefs((cur) => (cur.length ? cur : restoreDirs));
        if (badgesRef.current.length === 0) restoreBadges.forEach((b) => addBadgeWithOrder(b));
        abortComposerSubmit('composer-send-not-delivered');
      }
      return;
    }

    const uploadedFiles = await convertFiles();
    const mentionPayload = await resolveMentionPayload();
    // composeSubmitPayload owns the entire normal-path payload assembly
    // (files ordering + mention append + finalContent trim + displayOverride
    // decision). Single helper = one place to test, one place to change.
    // The badge + image-agent branches above don't share this path because
    // they mutate `prompt` (dispatchBadge) before composing finalContent.
    const payload = composeSubmitPayload({
      content,
      uploadedFiles,
      mentionPayload,
      directoryRefs,
    });
    const { files, finalContent } = payload;
    const hasFiles = files.length > 0;

    // Empty submit: nothing to send and nothing to lose — clear silently.
    if (!finalContent && !hasFiles) return;
    // Disabled while content/attachments are present: preserve the composer
    // (a bare return here would let PromptInput clear the screenshot) (#615).
    if (disabled) abortComposerSubmit('composer-disabled');

    // Check if it's a direct slash command typed in the input.
    if (!hasFiles) {
      const slashResult = resolveDirectSlash(finalContent);
      if (slashResult.action === 'immediate_command' || slashResult.action === 'set_badge' || slashResult.action === 'unknown_slash_badge') {
        // Slash commands must NOT execute or queue during streaming —
        // destructive commands (e.g. /clear) would race with the active stream.
        if (isStreaming) return;
        if (slashResult.action === 'immediate_command') {
          if (onCommand) {
            setInputValue('');
            onCommand(slashResult.commandValue!);
            return;
          }
        } else {
          addBadgeWithOrder(slashResult.badge!);
          setInputValue('');
          return;
        }
      }
    }

    // displayOverride keeps the bubble's text clean — when the user
    // attached @ mentions OR + directory chips, hide the inflated
    // `[Referenced Directories]\n...` LLM-context section from the UI
    // (the chips above the bubble already carry that information).
    // Clear the composer text OPTIMISTICALLY, before awaiting delivery. The
    // first-message send (page.tsx `sendFirstMessage`) doesn't resolve until the
    // WHOLE stream finishes, and the composer is now a single stable-keyed
    // instance that no longer remounts at the isStreaming flip (#615) — so a
    // post-await clear left the just-sent text in the box for the entire turn
    // (the lingering-text bug). ChatView's `sendMessage` returns at accept (its
    // stream is fire-and-forget), which is why it cleared fine; clearing up-front
    // makes both paths behave the same.
    const restoreInput = inputValue;
    const restoreDirs = [...directoryRefs];
    setInputValue('');
    setDirectoryRefs([]);
    const delivered = await onSend(
      finalContent || 'Please review the attached file(s).',
      hasFiles ? files.slice() : undefined,
      undefined,
      payload.displayOverride,
      payload.mentions ? [...payload.mentions] : undefined,
    );
    if (delivered === false) {
      // Gated/no-op send — restore, but ONLY if the user hasn't started a new
      // message during the (possibly async) failure window, or we'd clobber
      // their new input (Codex P3). Functional updaters / live refs read the
      // CURRENT value, not this stale send-closure.
      setInputValue((cur) => (cur ? cur : restoreInput));
      setDirectoryRefs((cur) => (cur.length ? cur : restoreDirs));
      abortComposerSubmit('composer-send-not-delivered');
    }
    // Note: nothing to clear post-await — text and dirs were
    // cleared optimistically above, and we must NOT re-clear (the user may have
    // typed the next message while the turn streamed, and that must survive).
  }, [inputValue, goalPromptActive, planPromptActive, mentionNodeTypes, directoryRefs, onSend, onCommand, onModeChange, disabled, isStreaming, popover, badges, addBadgeWithOrder, clearBadgesWithOrder, setInputValue, fetchDirectorySummary, fetchMentionFileAttachment, blockingReasonIds]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Mention token behavior: one Backspace removes the whole @path token.
      if (e.key === 'Backspace') {
        const ta = textareaRef.current;
        const start = ta?.selectionStart ?? 0;
        const end = ta?.selectionEnd ?? 0;
        if (start === end && start > 0) {
          const before = inputValue.slice(0, start);
          const tokenMatch = before.match(/(^|\s)@([^\s@]+)\s$/) || before.match(/(^|\s)@([^\s@]+)$/);
          if (tokenMatch) {
            const mentionPath = (tokenMatch[2] || '').replace(/[.,!?;:)\]}]+$/, '');
            if (mentionPath && mentionNodeTypes[mentionPath]) {
              e.preventDefault();
              const boundaryLen = (tokenMatch[1] || '').length;
              const mentionStart = start - tokenMatch[0].length + boundaryLen;
              const mentionEnd = start;
              const next = `${inputValue.slice(0, mentionStart)}${inputValue.slice(mentionEnd)}`.replace(/\s{2,}/g, ' ');
              const stillHasSamePath = parseMentionRefs(next).some((m) => m.path === mentionPath);
              setInputValue(next);
              if (!stillHasSamePath) {
                setMentionNodeTypes((prev) => {
                  const updated = { ...prev };
                  delete updated[mentionPath];
                  return updated;
                });
                setMentionOrder((prev) => {
                  const updated = { ...prev };
                  delete updated[mentionPath];
                  return updated;
                });
              }
              requestAnimationFrame(() => {
                const el = textareaRef.current;
                if (!el) return;
                const pos = Math.max(0, Math.min(mentionStart, next.length));
                el.setSelectionRange(pos, pos);
              });
              return;
            }
          }
        }
      }

      const action = resolveKeyAction(e.key, {
        popoverMode: popover.popoverMode,
        popoverHasItems: popover.popoverItems.length > 0,
        inputValue,
        hasBadge: badges.length > 0,
        hasCliBadge: false,
      });

      switch (action.type) {
        case 'popover_navigate':
          e.preventDefault();
          popover.setSelectedIndex((prev) =>
            cycleIndex(prev, action.direction, popover.allDisplayedItems.length),
          );
          return;

        case 'popover_select':
          e.preventDefault();
          if (popover.allDisplayedItems[popover.selectedIndex]) {
            slashCommands.insertItem(popover.allDisplayedItems[popover.selectedIndex]);
          }
          return;

        case 'close_popover':
          e.preventDefault();
          popover.closePopover();
          return;

        case 'remove_badge':
          e.preventDefault();
          // Backspace/Escape pops the most recently added badge; matches the
          // mental model of "undo my last selection".
          if (badges.length > 0) removeBadgeWithOrder(badges[badges.length - 1].command);
          return;

        case 'passthrough':
          break;
      }
    },
    [popover, slashCommands, badges, inputValue, mentionNodeTypes, removeBadgeWithOrder, setInputValue]
  );

  const uniqueMentions = useMemo(() => dedupeMentionsByPath(mentions), [mentions]);
  const mentionEstimates = useMentionTokenEstimate(uniqueMentions, { sessionId, workingDirectory });
  // Synthetic MentionRef[] for directory chips so the estimate hook can
  // share its caching logic. The estimates feed both the per-chip
  // "~3.2K" label and the pending total.
  const directoryRefMentions = useMemo<MentionRef[]>(
    () => directoryRefs.map((path) => ({
      path,
      display: path,
      nodeType: 'directory' as const,
      sourceRange: { start: 0, end: 0 },
    })),
    [directoryRefs],
  );
  const directoryRefEstimates = useMentionTokenEstimate(directoryRefMentions, { sessionId, workingDirectory });
  // Attachment pending tokens — summed inside an embedded child of
  // PromptInput (where `usePromptInputAttachments` resolves) and
  // reported up via callback. See `<AttachmentPendingTracker>` below.
  const [attachmentPendingTokens, setAttachmentPendingTokens] = useState(0);
  // Total context tokens that will be added by the current chip
  // selection — shown as a "+pending" annotation in the Run status
  // panel so the user can preview the cost before sending. Includes
  // typed @ mentions, file-tree-attached directories, and PromptInput
  // file attachments alike.
  const pendingContextTokens = useMemo(
    () => computePendingContextTokens({
      attachmentPendingTokens,
      uniqueMentions,
      mentionEstimates,
      directoryRefs,
      directoryRefEstimates,
    }),
    [attachmentPendingTokens, uniqueMentions, mentionEstimates, directoryRefs, directoryRefEstimates],
  );
  useEffect(() => {
    onPendingContextTokensChange?.(pendingContextTokens);
  }, [pendingContextTokens, onPendingContextTokensChange]);

  // Phase 6 Phase 3 — per-source split of the same pending pool. Mirrors
  // computePendingContextTokens so the displayed total never disagrees
  // with the per-source rows in the Context popover breakdown.
  const pendingContextSubTotals = useMemo(
    () => computePendingContextSubTotals({
      attachmentPendingTokens,
      uniqueMentions,
      mentionEstimates,
      directoryRefs,
      directoryRefEstimates,
    }),
    [attachmentPendingTokens, uniqueMentions, mentionEstimates, directoryRefs, directoryRefEstimates],
  );
  useEffect(() => {
    onPendingContextSubTotalsChange?.(pendingContextSubTotals);
  }, [pendingContextSubTotals, onPendingContextSubTotalsChange]);

  const removeDirectoryRef = useCallback((path: string) => {
    setDirectoryRefs((prev) => prev.filter((p) => p !== path));
  }, []);

  // File-tree "+" on a folder dispatches `attach-directory-to-chat`
  // (rather than writing `@path/` into the textarea) so the chip lives
  // in the same green-capsule attachment row as files and images.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ path: string }>).detail;
      const rawPath = detail?.path;
      if (!rawPath) return;
      const normalized = rawPath.replace(/\/+$/, '');
      if (!normalized) return;
      setDirectoryRefs((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
    };
    window.addEventListener('attach-directory-to-chat', handler);
    return () => window.removeEventListener('attach-directory-to-chat', handler);
  }, []);

  // Run Checkpoint Round 2 — when the banner's confirm action fires,
  // we set the bypass flag and programmatically click the composer's
  // submit button. PromptInput's full submission pipeline (text +
  // attachments + mentions) then runs unchanged; handleSubmit reads
  // the bypass and skips its blocking-reasons check exactly once.
  useEffect(() => {
    const handler = () => {
      bypassBlockingRef.current = true;
      // Find this composer's submit button via the stable
      // `data-message-input-submit` hook on FileAwareSubmitButton.
      // We deliberately do NOT use aria-label — that gets i18n'd
      // ("发送消息" in zh) so a label-based query would silently
      // miss in non-en locales and the bypass flag would leak.
      // (Codex P2 fix, 2026-04-30.)
      const btn = typeof document !== 'undefined'
        ? document.querySelector('button[data-message-input-submit]') as HTMLButtonElement | null
        : null;
      if (btn && !btn.disabled) {
        btn.click();
      } else {
        // Submit button missing or disabled (e.g. empty input). Reset
        // the bypass so a stale flag doesn't leak into the next
        // user-initiated submit.
        bypassBlockingRef.current = false;
      }
    };
    window.addEventListener('run-checkpoint-confirm-send', handler);
    return () => window.removeEventListener('run-checkpoint-confirm-send', handler);
  }, []);

  const removeMention = useCallback((targetMention: MentionRef) => {
    let removedPath = '';
    let stillHasSamePath = false;
    setInputValue((prev) => {
      const parsed = parseMentionRefs(prev, mentionNodeTypes);
      const exact = parsed.find((m) =>
        m.path === targetMention.path
        && m.sourceRange?.start === targetMention.sourceRange?.start
        && m.sourceRange?.end === targetMention.sourceRange?.end
      );
      const target = exact || parsed.find((m) => m.path === targetMention.path);
      if (!target?.sourceRange) return prev;
      removedPath = target.path;
      const { start, end } = target.sourceRange;
      const before = prev.slice(0, start);
      let after = prev.slice(end);
      if (before.endsWith(' ') && after.startsWith(' ')) after = after.slice(1);
      const next = `${before}${after}`.replace(/\s{2,}/g, ' ').trimStart();
      stillHasSamePath = parseMentionRefs(next).some((m) => m.path === target.path);
      return next;
    });
    if (!removedPath) return;
    if (!stillHasSamePath) {
      setMentionNodeTypes((prev) => {
        if (!prev[removedPath]) return prev;
        const next = { ...prev };
        delete next[removedPath];
        return next;
      });
      setMentionOrder((prev) => {
        if (!prev[removedPath]) return prev;
        const next = { ...prev };
        delete next[removedPath];
        return next;
      });
    }
  }, [setInputValue, mentionNodeTypes]);

  // Drop-router for folders: browsers hand us directory drops as 0-size File
  // entries whose mediaType is ''. Default behavior in PromptInput would insert
  // them as bogus attachments. Route them to the existing @mention pipeline as
  // directory references instead — matching what the picker produces.
  const handleDirectoriesDropped = useCallback((dirs: File[]) => {
    const resolver = typeof window !== 'undefined' ? window.electronAPI?.fs?.getPathForFile : undefined;
    for (const dir of dirs) {
      const absolute = resolver ? resolver(dir) : '';
      // Without an absolute path (non-Electron or resolver missing), fall back
      // to the folder name — the LLM can still act on the name as a hint.
      const rawPath = absolute || dir.name;
      if (!rawPath) continue;
      const normalized = normalizeMentionPath(rawPath);
      window.dispatchEvent(new CustomEvent('insert-file-mention', {
        detail: { path: normalized, nodeType: 'directory' },
      }));
    }
  }, [normalizeMentionPath]);

  // 新版输入框默认展示“高”，并由同一个按钮承载推理强度与模型选择。
  const [localEffort, setLocalEffort] = useState<string>('high');
  const selectedEffort = effortProp ?? localEffort;
  const setSelectedEffort = useCallback((v: string) => {
    setLocalEffort(v);
    onEffortChange?.(v);
  }, [onEffortChange]);

  const currentModelValue = modelName || 'sonnet';
  const chatStatus: ChatStatus = isStreaming ? 'streaming' : 'ready';

  // Composer shell bg routed through the platform token (Phase 7b /
  // Phase 2). Default = `var(--background)` matches prior
  // `bg-background/80`; macOS profile drops alpha so vibrancy shows
  // through the composer hood.
  return (
    <div className="bg-[var(--platform-surface-bar)] backdrop-blur-lg px-4 pt-2 pb-1">
      <div className="mx-auto w-full max-w-3xl">
        <div className="relative">
          {/* Slash Command / File Popover */}
          <SlashCommandPopover
            popoverMode={popover.popoverMode}
            popoverRef={popover.popoverRef}
            filteredItems={popover.filteredItems}
            aiSuggestions={popover.aiSuggestions}
            aiSearchLoading={popover.aiSearchLoading}
            selectedIndex={popover.selectedIndex}
            allDisplayedItems={popover.allDisplayedItems}
            onInsertItem={slashCommands.insertItem}
            onSetSelectedIndex={popover.setSelectedIndex}
          />

          {/* Quick Actions — memory-driven suggestion chips */}
          <QuickActions
            isAssistantProject={!!isAssistantProject}
            hasMessages={!!hasMessages}
            onAction={async (text) => {
              // #615 — await delivery and clear ONLY when the send was actually
              // delivered. A gated send (provider / model / runtime / directory
              // not ready → onSend returns false) must keep the composer instead
              // of silently eating the user's text. Mirrors handleSubmit.
              const delivered = await onSend(text);
              if (delivered !== false) setInputValue('');
            }}
          />

          {/* PromptInput follows the canonical ai-elements composition:
              Body(Textarea) + Footer(Tools + Submit). Chip rows live as
              direct children of PromptInput so they collapse to zero DOM
              when empty (a wrapping `PromptInputHeader` would always
              render its addon padding even with no chips). The `+` action
              menu folds attach / insert-slash / pick-CLI into one entry. */}
          <PromptInput
            onSubmit={handleSubmit}
            accept=""
            multiple
            onDirectoriesDropped={handleDirectoriesDropped}
            className="[&_[data-slot=input-group]]:shadow-[var(--shadow-diffuse)]"
          >
            <FileTreeAttachmentBridge />
            {/* Chip rows: each carries its own `pt-2.5 px-3 order-first`
                so they float above the textarea via flex `order` and
                produce zero DOM when their data is empty — wrapping them
                in `PromptInputHeader` would re-introduce the addon's
                always-on padding even with no chips. */}
            <ComposerBadgeRow
              badges={badges}
              mentions={uniqueMentions}
              badgeOrder={badgeOrder}
              mentionOrder={mentionOrder}
              onRemoveBadge={removeBadgeWithOrder}
              onRemoveMention={removeMention}
              mentionEstimates={mentionEstimates}
            />
            <FileAttachmentsCapsules />
            <AttachmentPendingTracker onChange={setAttachmentPendingTokens} />
            <DirectoryRefsCapsules
              paths={directoryRefs}
              onRemove={removeDirectoryRef}
              estimates={directoryRefEstimates}
            />

            <PromptInputBody>
              <PromptInputTextarea
                ref={textareaRef}
                placeholder={
                  goalPromptActive
                    ? GOAL_PROMPT_PLACEHOLDER
                    : planPromptActive
                    ? PLAN_PROMPT_PLACEHOLDER
                    : isProviderLoading
                    ? t('messageInput.placeholderLoading' as TranslationKey)
                    : badges.length > 0
                      ? t('messageInput.placeholderWithBadges' as TranslationKey)
                      : t('messageInput.placeholderDefault' as TranslationKey)
                }
                value={inputValue}
                onChange={(e) => slashCommands.handleInputChange(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                onFocus={handleAssistantFocus}
                disabled={disabled}
                className="min-h-12 px-4 py-3"
              />
            </PromptInputBody>

            <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger
                    aria-label={t('messageInput.actionMenuTooltip' as TranslationKey)}
                    tooltip={t('messageInput.actionMenuTooltip' as TranslationKey)}
                  />
                  <PromptInputActionMenuContent className="w-[372px] max-w-[calc(100vw-2rem)] rounded-xl p-2">
                    <FileAndFolderMenuItem />
                    <ComposerPlusMenuItem
                      icon={<Target size={20} />}
                      label="目标"
                      description="设置 Codex 将持续努力实现的目标"
                      disabled={!onCommand}
                      onSelect={activateGoalPrompt}
                    />
                    <ComposerPlusMenuItem
                      icon={<ListChecks size={20} />}
                      label="计划模式"
                      description="开启计划模式"
                      disabled={modeChangeDisabled || !onModeChange}
                      onSelect={activatePlanPrompt}
                    />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>

                <ComposerPermissionSelector
                  permissionProfile={permissionProfile}
                  onPermissionChange={onPermissionChange}
                  disabled={!onPermissionChange}
                />
                {goalPromptActive && <GoalPromptModePill onCancel={cancelGoalPrompt} />}
                {planPromptActive && <PlanPromptModePill onCancel={cancelPlanPrompt} />}
              </PromptInputTools>

              <div className="ml-auto flex items-center gap-1">
                <ComposerReasoningModelSelector
                  selectedEffort={selectedEffort}
                  onEffortChange={setSelectedEffort}
                  currentModelOption={currentModelOption}
                  currentModelValue={currentModelValue}
                  currentProviderIdValue={currentProviderIdValue}
                  modelOptions={modelOptions}
                  onModelChange={onModelChange}
                  onProviderModelChange={onProviderModelChange}
                  persistLastModel={!codexOnly}
                />
                <FileAwareSubmitButton
                  status={chatStatus}
                  onStop={onStop}
                  disabled={disabled}
                  inputValue={inputValue}
                  hasBadge={hasBadge}
                />
              </div>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>

    </div>
  );
}
