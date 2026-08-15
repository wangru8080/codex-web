'use client';

import { memo, useRef, useState, useCallback, useEffect, useMemo, type KeyboardEvent, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
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
import type { FileAttachment, MentionRef, PermissionProfile, SkillInputReference } from '@/types';
import type { ThreadTokenUsage } from '@/codex/protocol/generated/v2/ThreadTokenUsage';
import type { McpServerStatus } from '@/codex/protocol/generated/v2/McpServerStatus';
import type { GetAccountRateLimitsResponse } from '@/codex/protocol/generated/v2/GetAccountRateLimitsResponse';
import type { HookMetadata } from '@/codex/protocol/generated/v2/HookMetadata';
import type { TurnFileChangeSummary } from '@/codex-web/file-change-summary';
import type { ComposerTurnPlan as ComposerTurnPlanData } from '@/codex-web/composer-turn-plan';
import { useAppServerActions, useAppServerSelector } from '@/codex-web/AppServerProvider';
import { AppServerFilePreviewError } from '@/codex-web/app-server-files';
import { buildHookTrustEdit, hookNeedsReview } from '@/codex-web/hooks-config';
import { SlashCommandPopover } from './SlashCommandPopover';
import { ContextWindowIndicator } from './ContextWindowIndicator';
import { FileAwareSubmitButton, FileTreeAttachmentBridge, FileAttachmentsCapsules, FileReferenceCapsules, FileExcerptCapsules, ComposerBadgeRow, DirectoryRefsCapsules, AttachmentPendingTracker } from './MessageInputParts';
import { ComposerFileChanges } from './ComposerFileChanges';
import { ComposerTurnPlan } from './ComposerTurnPlan';
import { useMentionTokenEstimate } from '@/hooks/useMentionTokenEstimate';
import { dataUrlToFileAttachment } from '@/lib/file-utils';
import { getPluginIconUrl } from '@/lib/media-resource-cache';
import { usePopoverState } from '@/hooks/usePopoverState';
import { useProviderModels, isComposerProviderLoading } from '@/hooks/useProviderModels';
import { resolveComposerModelAutoCorrect } from '@/lib/model-option-match';
// Import from `chat-runtime-shared` (client-safe). See ChatView import
// note + `src/lib/chat-runtime-shared.ts` doc-block. Even type-only
// imports from `chat-runtime.ts` are risky if the build leans on
// runtime resolution paths; the shared module is the future-proof
// choice for any client bundle.
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
  composeSubmitPayload,
  GOAL_PROMPT_PLACEHOLDER,
  PLAN_PROMPT_PLACEHOLDER,
  goalCommandFromPrompt,
  planPromptFromInput,
} from '@/lib/message-input-logic';
import { QuickActions } from './QuickActions';
import { CaretDown, CaretRight, Check, Gear, X } from '@/components/ui/icon';
import { HandPalm, ListChecks, Paperclip, ShieldCheck, ShieldWarning, Target } from '@phosphor-icons/react';
import { ADD_TO_CHAT_EVENT, isAddToChatDetail } from '@/lib/add-to-chat-event';
import {
  buildFileExcerptPrompt,
  encodeFileExcerptDisplay,
  type FileExcerptReference,
} from '@/lib/file-excerpt-reference';

const MAX_MENTION_FILE_BYTES = 256 * 1024; // 256KB per @file mention
const MAX_MENTION_FILE_COUNT = 6;
const MAX_DIRECTORY_MENTION_COUNT = 3;
const MAX_DIRECTORY_PREVIEW_ITEMS = 30;

function normalizeWorkspaceReferencePath(rawPath: string, workingDirectory?: string): string {
  const normalizedRaw = rawPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!workingDirectory) return normalizedRaw;
  const normalizedBase = workingDirectory.replace(/\\/g, '/').replace(/\/+$/, '').replace(/^\/+/, '');
  if (normalizedRaw.startsWith(normalizedBase + '/')) {
    return normalizedRaw.slice(normalizedBase.length + 1);
  }
  return normalizedRaw;
}

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
  onSend: (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string, mentions?: MentionRef[], selectedSkills?: readonly SkillInputReference[], modeOverride?: string) => boolean | void | Promise<boolean | void>;
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
  contextWindowUsage?: ThreadTokenUsage | null;
  /** SDK init metadata — when available, used to validate command/skill availability */
  sdkInitMeta?: { tools?: unknown; slash_commands?: unknown; skills?: unknown } | null;
  /** Initial value to prefill in the input */
  initialValue?: string;
  initialSkill?: SkillInputReference & { label?: string; description?: string };
  /** Whether this session is an assistant workspace project */
  isAssistantProject?: boolean;
  /** Whether the session already has messages */
  hasMessages?: boolean;
  /** Notify parent when the total estimated tokens of current attachments changes. */
  onPendingContextTokensChange?: (tokens: number) => void;
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
  runtime?: unknown;
  /** Codex-only Web 收缩：新建聊天只读取 Codex 账户模型。 */
  codexOnly?: boolean;
  /** 可选文件选择器 accept；空字符串允许任意文件。 */
  attachmentsAccept?: string;
  fileChangeSummary?: TurnFileChangeSummary | null;
  turnPlan?: ComposerTurnPlanData | null;
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

function FileAndFolderMenuItem({ imageOnly = false }: { imageOnly?: boolean }) {
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
      label={imageOnly ? "图片" : "文件和文件夹"}
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
  const [menuOpen, setMenuOpen] = useState(false);
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
      setMenuOpen(false);
      window.requestAnimationFrame(() => setShowWarning(true));
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

  const handleWarningOpenChange = useCallback((open: boolean) => {
    setShowWarning(open);
    if (!open) setPendingChoice(null);
  }, []);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
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

      <AlertDialog open={showWarning} onOpenChange={handleWarningOpenChange}>
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

function displayModelShortLabel(label: string): string {
  const cleaned = label.replace(/^gpt[-\s]?/i, '').replace(/^GPT[-\s]?/, '');
  return cleaned || label;
}

function ComposerReasoningModelSelector({
  selectedEffort,
  onEffortChange,
  effortOptions,
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
  effortOptions: Array<{ value: string; label: string }>;
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
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const hasAvailableModel = modelOptions.length > 0;
  const effectiveEffort = selectedEffort === 'auto' ? 'high' : selectedEffort;
  const effortLabel = effortOptions.find((item) => item.value === effectiveEffort)?.label ?? effectiveEffort;
  const modelLabel = currentModelOption?.label || currentModelValue || modelOptions[0]?.label || '';
  const modelShortLabel = hasAvailableModel
    ? displayModelShortLabel(modelLabel)
    : t('messageInput.noAvailableModel' as TranslationKey);

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
        disabled={disabled || !hasAvailableModel}
        onClick={() => {
          setOpen((prev) => !prev);
          setModelMenuOpen(false);
        }}
        className="gap-1.5 px-2"
      >
        <span className="text-sm font-medium">{modelShortLabel}</span>
        {hasAvailableModel && (
          <>
            <span className="text-sm font-medium text-muted-foreground">{effortLabel}</span>
            <CaretDown size={12} className="text-muted-foreground" />
          </>
        )}
      </PromptInputButton>

      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-[260px] rounded-2xl border bg-popover p-1.5 shadow-[var(--shadow-diffuse)]">
          <div className="px-2.5 pb-1.5 pt-1 text-xs font-semibold text-muted-foreground/65">推理</div>
          <div className="space-y-0.5" data-source-breadcrumb="app-server.model/list">
            {effortOptions.map((option) => (
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

function base64DecodedSize(data: string): number {
  if (!data) return 0;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(data.length * 3 / 4) - padding);
}

function mentionFileMimeType(filename: string): string {
  const extension = filename.toLowerCase().split('.').pop() || '';
  if (extension === 'json' || extension === 'jsonc') return 'application/json';
  if (extension === 'yaml' || extension === 'yml') return 'application/yaml';
  if (extension === 'xml') return 'application/xml';
  if (extension === 'pdf') return 'application/pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension)) {
    return extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
  }
  const textExtensions = new Set([
    'txt', 'md', 'markdown', 'rst', 'log', 'csv', 'tsv', 'toml', 'ini', 'cfg', 'conf',
    'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
    'vue', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp',
    'cs', 'php', 'pl', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'sql', 'graphql',
    'proto', 'env', 'gitignore', 'dockerfile',
  ]);
  return textExtensions.has(extension) ? 'text/plain' : 'application/octet-stream';
}

export const MessageInput = memo(function MessageInput({
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
  contextWindowUsage,
  sdkInitMeta,
  initialValue,
  initialSkill,
  isAssistantProject,
  hasMessages,
  onPendingContextTokensChange,
  onModeChange,
  modeChangeDisabled,
  blockingReasonIds,
  codexOnly,
  attachmentsAccept,
  fileChangeSummary,
  turnPlan,
}: MessageInputProps) {
  const { t } = useTranslation();
  const appServer = useAppServerActions();
  const config = useAppServerSelector((state) => state.config);
  const appServerConnection = useAppServerSelector((state) => state.connection.data);
  const resolvedAttachmentsAccept = attachmentsAccept ?? '';
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
  const [composerActivityPanel, setComposerActivityPanel] = useState<'files' | 'tasks' | null>(null);
  const [commandPanel, setCommandPanel] = useState<null | 'mcp' | 'review' | 'reasoning' | 'model' | 'status' | 'memory'>(null);
  const [commandError, setCommandError] = useState('');
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [reviewBranch, setReviewBranch] = useState('main');
  const [rateLimits, setRateLimits] = useState<GetAccountRateLimitsResponse | null>(null);
  const [pendingHooks, setPendingHooks] = useState<HookMetadata[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<Array<{ name: string; label: string; description: string; uri: string; iconUrl: string | null }>>([]);
  const [trustingHooks, setTrustingHooks] = useState(false);
  const memoriesConfig = config?.data.config.memories as Record<string, unknown> | undefined;
  const [useMemories, setUseMemories] = useState(() => memoriesConfig?.use_memories !== false);
  const [generateMemories, setGenerateMemories] = useState(() => memoriesConfig?.generate_memories !== false);

  useEffect(() => {
    if (!memoriesConfig) return;
    setUseMemories(memoriesConfig.use_memories !== false);
    setGenerateMemories(memoriesConfig.generate_memories !== false);
  }, [memoriesConfig]);

  const refreshPendingHooks = useCallback(async () => {
    if (appServerConnection !== 'connected') {
      setPendingHooks([]);
      return;
    }
    try {
      const response = await appServer.listHooks({
        cwds: workingDirectory ? [workingDirectory] : [],
      });
      setPendingHooks((response.data[0]?.hooks ?? []).filter(hookNeedsReview));
    } catch {
      setPendingHooks([]);
    }
  }, [appServer, appServerConnection, workingDirectory]);

  useEffect(() => {
    void refreshPendingHooks();
  }, [refreshPendingHooks, config?.data]);

  useEffect(() => {
    if (appServerConnection !== 'connected') {
      setInstalledPlugins([]);
      return;
    }
    let cancelled = false;
    void appServer.listInstalledPlugins(workingDirectory ? { cwds: [workingDirectory] } : {})
      .then(async (response) => {
        if (cancelled) return;
        const plugins = await Promise.all(response.marketplaces.flatMap((marketplace) => marketplace.plugins
          .filter((plugin) => plugin.installed && plugin.enabled)
          .map(async (plugin) => ({
            name: plugin.name,
            label: plugin.interface?.displayName || plugin.name,
            description: plugin.interface?.shortDescription || '',
            uri: `plugin://${plugin.name}@${marketplace.name}/`,
            iconUrl: await getPluginIconUrl(plugin.interface, appServer.readFileLimited),
          }))));
        if (!cancelled) setInstalledPlugins(plugins);
      })
      .catch(() => { if (!cancelled) setInstalledPlugins([]); });
    return () => { cancelled = true; };
  }, [appServer, appServerConnection, workingDirectory, config?.data]);

  const trustAllPendingHooks = useCallback(async () => {
    if (pendingHooks.length === 0) return;
    setTrustingHooks(true);
    try {
      await appServer.writeConfigEdits([buildHookTrustEdit(pendingHooks)]);
      await refreshPendingHooks();
    } finally {
      setTrustingHooks(false);
    }
  }, [appServer, pendingHooks, refreshPendingHooks]);
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
  const [fileReferencePaths, setFileReferencePaths] = useState<string[]>([]);
  const [fileExcerptReferences, setFileExcerptReferences] = useState<FileExcerptReference[]>([]);
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

  // Markdown preview selections stay out of the textarea. The card carries
  // compact source metadata while the full selected text remains in state for
  // the model-only prompt assembled at submit time.
  useEffect(() => {
    function handle(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (!isAddToChatDetail(detail)) return;
      const reference: FileExcerptReference = {
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        path: detail.sourcePath,
        name: detail.sourcePath.split(/[\\/]/).pop() || detail.sourcePath,
        text: detail.text,
        startLine: detail.startLine,
        endLine: detail.endLine,
      };
      setFileExcerptReferences((current) => current.some((item) =>
        item.path === reference.path
          && item.text === reference.text
          && item.startLine === reference.startLine
          && item.endLine === reference.endLine
      ) ? current : [...current, reference]);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
    window.addEventListener(ADD_TO_CHAT_EVENT, handle);
    return () => window.removeEventListener(ADD_TO_CHAT_EVENT, handle);
  }, []);

  const mentions = useMemo(() => {
    // Render chips only for explicitly inserted/known mentions.
    return parseMentionRefs(inputValue, mentionNodeTypes).filter((m) => !!mentionNodeTypes[m.path]);
  }, [inputValue, mentionNodeTypes]);
  const fileReferenceMentions = useMemo<MentionRef[]>(
    () => fileReferencePaths.map((path) => ({
      path,
      display: path.split(/[\\/]/).pop() || path,
      nodeType: 'file' as const,
      sourceRange: { start: 0, end: 0 },
    })),
    [fileReferencePaths],
  );

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
  const [localEffort, setLocalEffort] = useState<string>('high');
  const selectedEffort = effortProp ?? localEffort;
  const setSelectedEffort = useCallback((value: string) => {
    setLocalEffort(value);
    onEffortChange?.(value);
  }, [onEffortChange]);
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
  const addBadgeWithOrder = useCallback((badge: { command: string; label: string; description: string; kind: 'agent_skill' | 'plugin' | 'slash_command' | 'sdk_command' | 'codepilot_command'; installedSource?: 'agents' | 'claude'; skillPath?: string; pluginUri?: string; pluginIconUrl?: string | null }) => {
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

  useEffect(() => {
    if (!initialSkill?.name) return;
    addBadgeWithOrder({
      command: initialSkill.name,
      label: initialSkill.label || initialSkill.name,
      description: initialSkill.description || '',
      kind: 'agent_skill',
      skillPath: initialSkill.path,
    });
  }, [initialSkill?.name, initialSkill?.path, initialSkill?.label, initialSkill?.description, addBadgeWithOrder]);

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

  const handleComposerCommand = useCallback((command: string) => {
    setCommandError('');
    setCommandPanel(null);
    if (command === '/goal') {
      activateGoalPrompt();
      return;
    }
    if (command === '/plan') {
      activatePlanPrompt();
      return;
    }
    if (command === '/compact') {
      if (!sessionId) {
        setCommandError('请先开始对话，再压缩上下文');
        return;
      }
      void appServer.compactThread(sessionId).catch((error) => {
        setCommandError(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    if (command === '/mcp') {
      setCommandPanel('mcp');
      void appServer.listMcpServerStatus().then(setMcpStatuses).catch((error) => {
        setCommandError(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    if (command === '/review') setCommandPanel('review');
    else if (command === '/reasoning') setCommandPanel('reasoning');
    else if (command === '/model') setCommandPanel('model');
    else if (command === '/status') {
      setCommandPanel('status');
      void appServer.readAccountRateLimits().then(setRateLimits).catch(() => setRateLimits(null));
    }
    else if (command === '/memories') setCommandPanel('memory');
    else onCommand?.(command);
  }, [activateGoalPrompt, activatePlanPrompt, appServer, onCommand, sessionId]);

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
    onCommand: handleComposerCommand,
    addBadge: addBadgeWithOrder,
    onMentionInserted: (mention) => {
      setMentionNodeTypes((prev) => ({ ...prev, [mention.path]: mention.nodeType }));
      ensureMentionOrder(mention.path);
    },
    onFileReferenceSelected: (reference) => {
      const path = normalizeWorkspaceReferencePath(reference.path, workingDirectory);
      if (!path) return;
      setFileReferencePaths((current) => current.includes(path) ? current : [...current, path]);
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

  useEffect(() => {
    const handler = (event: Event) => {
      const rawPath = (event as CustomEvent<{ path?: string }>).detail?.path?.trim();
      const path = rawPath ? normalizeWorkspaceReferencePath(rawPath, workingDirectory) : '';
      if (!path) return;
      setFileReferencePaths((current) => current.includes(path) ? current : [...current, path]);
      setTimeout(() => textareaRef.current?.focus(), 0);
    };
    window.addEventListener('insert-file-reference', handler);
    return () => window.removeEventListener('insert-file-reference', handler);
  }, [workingDirectory]);

  const normalizeMentionPath = useCallback((rawPath: string): string => {
    return normalizeWorkspaceReferencePath(rawPath, workingDirectory);
  }, [workingDirectory]);

  const fetchMentionFileAttachment = useCallback(async (mentionPath: string): Promise<{ attachment: FileAttachment | null; limitNote?: string }> => {
    const safePath = normalizeMentionPath(mentionPath);
    const filename = safePath.split('/').filter(Boolean).pop() || 'file';
    if (!workingDirectory) return { attachment: null };
    try {
      const absolutePath = joinPath(workingDirectory, safePath);
      const response = await appServer.readFileLimited(absolutePath, MAX_MENTION_FILE_BYTES);
      const size = base64DecodedSize(response.dataBase64);
      if (size > MAX_MENTION_FILE_BYTES) {
        return { attachment: null, limitNote: `@${safePath}: omitted (file too large > 256KB).` };
      }
      return {
        attachment: {
          id: `mention-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: filename,
          type: mentionFileMimeType(filename),
          size,
          data: response.dataBase64,
          originPath: safePath,
        },
      };
    } catch (error) {
      if (error instanceof AppServerFilePreviewError && error.code === 'file_too_large') {
        return { attachment: null, limitNote: `@${safePath}: omitted (file too large > 256KB).` };
      }
      return { attachment: null };
    }
  }, [workingDirectory, normalizeMentionPath, appServer]);

  const fetchDirectorySummary = useCallback(async (mentionPath: string): Promise<string | null> => {
    if (!workingDirectory) return null;
    const safePath = normalizeMentionPath(mentionPath);
    const dir = joinPath(workingDirectory, safePath);
    try {
      const response = await appServer.readDirectory(dir);
      const preview = response.entries.slice(0, MAX_DIRECTORY_PREVIEW_ITEMS).map((entry) => (
        entry.isDirectory ? `- ${entry.fileName}/` : `- ${entry.fileName}`
      ));
      const extra = response.entries.length > MAX_DIRECTORY_PREVIEW_ITEMS
        ? `\n- ... (${response.entries.length - MAX_DIRECTORY_PREVIEW_ITEMS} more)`
        : '';
      return `Directory reference @${safePath}/\n${preview.join('\n')}${extra}`;
    } catch {
      return null;
    }
  }, [workingDirectory, normalizeMentionPath, appServer]);

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
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`无法读取附件 ${file.filename || 'file'}: ${message}`);
        }
      }
      return attachments;
    };

    const resolveMentionPayload = async () => {
      // Only treat mentions inserted/confirmed by the picker (or file-tree bridge)
      // as structured mentions. Plain typed "@foo" should remain plain text.
      const parsedMentions = parseMentionRefs(inputValue, mentionNodeTypes)
        .filter((m) => !!mentionNodeTypes[m.path]);
      const dedupedMentions = dedupeMentionsByPath([...parsedMentions, ...fileReferenceMentions]);
      const fileReferenceSet = new Set(fileReferencePaths);

      const mentionFiles: FileAttachment[] = [];
      const directoryNotes: string[] = [];
      const limitNotes: string[] = [];
      let usedDirectoryMentions = 0;
      for (const mention of dedupedMentions) {
        if (fileReferenceSet.has(mention.path)) {
          continue;
        }
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
        .map((b) => ({
          name: canonicalizeSkillNameInline(b.command || b.label),
          path: b.skillPath,
        }))
        .filter((skill) => skill.name.length > 0);
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
        fileReferencePaths,
      });
      const { files, finalContent: finalPrompt } = payload;
      const modelPrompt = buildFileExcerptPrompt(finalPrompt, fileExcerptReferences);
      const displayPrompt = encodeFileExcerptDisplay(displayLabel, fileExcerptReferences);
      // Clear OPTIMISTICALLY before awaiting delivery (same rationale as the
      // normal path below): the first-message send doesn't resolve until the
      // stream ends and the composer no longer remounts (#615), so a post-await
      // clear left the sent text + skill/slash badges sitting in the box for the
      // whole turn (Codex P2 — the badge path had the same lingering bug).
      const restoreInput = inputValue;
      const restoreDirs = [...directoryRefs];
      const restoreFileRefs = [...fileReferencePaths];
      const restoreExcerpts = [...fileExcerptReferences];
      const restoreBadges = [...badges];
      clearBadgesWithOrder();
      setInputValue('');
      setDirectoryRefs([]);
      setFileReferencePaths([]);
      setFileExcerptReferences([]);
      const delivered = await onSend(
        modelPrompt,
        files.length > 0 ? files.slice() : undefined,
        undefined,
        displayPrompt,
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
        setFileReferencePaths((cur) => (cur.length ? cur : restoreFileRefs));
        setFileExcerptReferences((cur) => (cur.length ? cur : restoreExcerpts));
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
      fileReferencePaths,
    });
    const { files, finalContent } = payload;
    const hasFiles = files.length > 0;

    // Empty submit: nothing to send and nothing to lose — clear silently.
    if (!finalContent && !hasFiles && fileExcerptReferences.length === 0) return;
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
          setInputValue('');
          handleComposerCommand(slashResult.commandValue!);
          return;
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
    const restoreFileRefs = [...fileReferencePaths];
    const restoreExcerpts = [...fileExcerptReferences];
    const modelContent = buildFileExcerptPrompt(
      finalContent || 'Please review the referenced file excerpt(s).',
      fileExcerptReferences,
    );
    const displayContent = encodeFileExcerptDisplay(
      payload.displayOverride ?? content,
      fileExcerptReferences,
    );
    setInputValue('');
    setDirectoryRefs([]);
    setFileReferencePaths([]);
    setFileExcerptReferences([]);
    const delivered = await onSend(
      modelContent,
      hasFiles ? files.slice() : undefined,
      undefined,
      displayContent,
      payload.mentions ? [...payload.mentions] : undefined,
    );
    if (delivered === false) {
      // Gated/no-op send — restore, but ONLY if the user hasn't started a new
      // message during the (possibly async) failure window, or we'd clobber
      // their new input (Codex P3). Functional updaters / live refs read the
      // CURRENT value, not this stale send-closure.
      setInputValue((cur) => (cur ? cur : restoreInput));
      setDirectoryRefs((cur) => (cur.length ? cur : restoreDirs));
      setFileReferencePaths((cur) => (cur.length ? cur : restoreFileRefs));
      setFileExcerptReferences((cur) => (cur.length ? cur : restoreExcerpts));
      abortComposerSubmit('composer-send-not-delivered');
    }
    // Note: nothing to clear post-await — text and dirs were
    // cleared optimistically above, and we must NOT re-clear (the user may have
    // typed the next message while the turn streamed, and that must survive).
  }, [inputValue, goalPromptActive, planPromptActive, mentionNodeTypes, directoryRefs, fileReferenceMentions, fileReferencePaths, fileExcerptReferences, onSend, onCommand, handleComposerCommand, onModeChange, disabled, isStreaming, popover, badges, addBadgeWithOrder, clearBadgesWithOrder, setInputValue, fetchDirectorySummary, fetchMentionFileAttachment, blockingReasonIds]);

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
  // Pre-send estimate for RunCheckpoint. The visible context ring only
  // shows authoritative app-server usage after a turn is accepted.
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

  const removeDirectoryRef = useCallback((path: string) => {
    setDirectoryRefs((prev) => prev.filter((p) => p !== path));
  }, []);
  const removeFileReference = useCallback((path: string) => {
    setFileReferencePaths((prev) => prev.filter((item) => item !== path));
  }, []);
  const removeFileExcerpt = useCallback((id: string) => {
    setFileExcerptReferences((prev) => prev.filter((item) => item.id !== id));
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
    for (const dir of dirs) {
      const normalized = normalizeMentionPath(dir.name);
      if (!normalized) continue;
      window.dispatchEvent(new CustomEvent('insert-file-mention', {
        detail: { path: normalized, nodeType: 'directory' },
      }));
    }
  }, [normalizeMentionPath]);

  const currentModelValue = modelName || '';
  const effortOptions = (currentModelOption?.supportedEffortLevels ?? []).map((value) => {
    const key = `messageInput.effort.${value}` as TranslationKey;
    const label = t(key);
    return { value, label: label === key ? value : label };
  });
  const chatStatus: ChatStatus = isStreaming ? 'streaming' : 'ready';
  const standaloneTurnPlan = !!turnPlan && !fileChangeSummary;
  const wasStandaloneTurnPlanRef = useRef(false);

  useEffect(() => {
    if (standaloneTurnPlan !== wasStandaloneTurnPlanRef.current) {
      setComposerActivityPanel(standaloneTurnPlan ? 'tasks' : null);
      wasStandaloneTurnPlanRef.current = standaloneTurnPlan;
      return;
    }
    if (
      (composerActivityPanel === 'files' && !fileChangeSummary) ||
      (composerActivityPanel === 'tasks' && !turnPlan)
    ) {
      setComposerActivityPanel(null);
    }
  }, [composerActivityPanel, fileChangeSummary, standaloneTurnPlan, turnPlan]);

  // Composer shell bg routed through the platform token (Phase 7b /
  // Phase 2). Default = `var(--background)` matches prior
  // `bg-background/80`; macOS profile drops alpha so vibrancy shows
  // through the composer hood.
  return (
    <div className="relative z-20 bg-[var(--platform-surface-bar)] backdrop-blur-lg px-4 pt-2 pb-1">
      <div className="mx-auto w-full max-w-3xl">
        {(fileChangeSummary || turnPlan) && (
          <div
            className={cn(
              'relative mb-2 flex min-w-0 justify-center gap-2',
              standaloneTurnPlan && 'w-full',
            )}
            data-testid="composer-activity-bar"
            data-variant={standaloneTurnPlan ? 'standalone-task' : 'compact'}
          >
            <ComposerFileChanges
              summary={fileChangeSummary ?? null}
              expanded={composerActivityPanel === 'files'}
              onExpandedChange={(expanded) => setComposerActivityPanel(expanded ? 'files' : null)}
            />
            <ComposerTurnPlan
              plan={turnPlan ?? null}
              expanded={composerActivityPanel === 'tasks'}
              onExpandedChange={(expanded) => setComposerActivityPanel(expanded ? 'tasks' : null)}
              variant={standaloneTurnPlan ? 'standalone' : 'compact'}
            />
          </div>
        )}
        {pendingHooks.length > 0 && (
          <div
            className="mb-2 flex min-h-10 items-center gap-3 rounded-xl border border-status-warning-border bg-status-warning-muted px-3 py-2 text-xs text-status-warning-foreground"
            data-testid="composer-hooks-review"
            data-source-breadcrumb="app-server.hooks/list"
          >
            <CodexWebIcon name="warning" className="text-status-warning-foreground" aria-hidden />
            <span className="min-w-0 flex-1 font-medium">
              {t('settings.hooksPendingReview', { count: pendingHooks.length })}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => void trustAllPendingHooks()} disabled={trustingHooks}>
              {t('settings.hooksTrustAll')}
            </Button>
            <Button type="button" variant="ghost" size="sm" asChild>
              <a href="/settings/hooks">{t('settings.hooksReview')}</a>
            </Button>
          </div>
        )}
        <div className="relative">
          {(commandPanel || commandError) && (
            <div className="absolute bottom-full left-0 z-50 mb-2 max-h-80 w-full overflow-y-auto rounded-2xl border bg-popover p-3 shadow-[var(--shadow-diffuse)]" data-testid="composer-command-panel">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {commandPanel === 'mcp' ? 'MCP' : commandPanel === 'review' ? '代码审查' : commandPanel === 'reasoning' ? '推理' : commandPanel === 'model' ? '模型' : commandPanel === 'status' ? '状态' : commandPanel === 'memory' ? '任务记忆' : '命令'}
                </span>
                <button type="button" className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent" onClick={() => { setCommandPanel(null); setCommandError(''); }}>关闭</button>
              </div>
              {commandError && <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{commandError}</div>}

              {commandPanel === 'mcp' && (
                <div className="space-y-1" data-source-breadcrumb="app-server.mcpServerStatus/list">
                  {mcpStatuses.length === 0
                    ? <div className="py-2 text-sm text-muted-foreground">没有 app-server 返回的 MCP 服务</div>
                    : mcpStatuses.map((server) => (
                      <div key={server.name} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent">
                        <span className="min-w-0 flex-1 truncate font-mono text-sm">{server.name}</span>
                        <span className="text-xs text-muted-foreground">{Object.keys(server.tools).length} 个工具</span>
                        <span className="text-xs text-muted-foreground">{server.authStatus === 'notLoggedIn' ? '未登录' : '已启用'}</span>
                      </div>
                    ))}
                </div>
              )}

              {commandPanel === 'review' && (
                <div className="space-y-1">
                  <button type="button" disabled={!sessionId} className="flex w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50" onClick={() => {
                    if (!sessionId) return;
                    setCommandPanel(null);
                    void appServer.startReview({ threadId: sessionId, target: { type: 'uncommittedChanges' } }).catch((error) => setCommandError(error instanceof Error ? error.message : String(error)));
                  }}>审查未提交的更改</button>
                  <div className="flex gap-2 px-3 py-1">
                    <input aria-label="基准分支" value={reviewBranch} onChange={(event) => setReviewBranch(event.target.value)} className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" placeholder="基准分支" />
                    <button type="button" disabled={!sessionId || !reviewBranch.trim()} className="rounded-lg border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50" onClick={() => {
                    if (!sessionId) return;
                    setCommandPanel(null);
                    void appServer.startReview({ threadId: sessionId, target: { type: 'baseBranch', branch: reviewBranch.trim() } }).catch((error) => setCommandError(error instanceof Error ? error.message : String(error)));
                    }}>比较</button>
                  </div>
                  {!sessionId && <div className="px-3 py-1 text-xs text-muted-foreground">请先开始对话</div>}
                </div>
              )}

              {commandPanel === 'reasoning' && (
                <div className="space-y-1" data-source-breadcrumb="app-server.model/list">
                  {effortOptions.map((option) => (
                    <button key={option.value} type="button" className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setSelectedEffort(option.value); setCommandPanel(null); }}>
                      {option.label}{selectedEffort === option.value && <Check size={18} className="ml-auto" />}
                    </button>
                  ))}
                </div>
              )}

              {commandPanel === 'model' && (
                <div className="space-y-1" data-source-breadcrumb="app-server.model/list">
                  {modelOptions.map((option) => (
                    <button key={option.value} type="button" className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => {
                      onModelChange?.(option.value);
                      onProviderModelChange?.(currentProviderIdValue, option.value);
                      setCommandPanel(null);
                    }}>
                      {option.label}{(option.value === currentModelOption?.value || option.value === modelName) && <Check size={18} className="ml-auto" />}
                    </button>
                  ))}
                </div>
              )}

              {commandPanel === 'status' && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">任务</dt><dd className="break-all font-mono">{sessionId || '尚未创建'}</dd>
                  <dt className="text-muted-foreground">上下文</dt><dd data-source-breadcrumb="app-server.thread/tokenUsage/updated">{contextWindowUsage?.modelContextWindow ? `${contextWindowUsage.total.totalTokens.toLocaleString()} / ${contextWindowUsage.modelContextWindow.toLocaleString()} 标记` : '不可用'}</dd>
                  <dt className="text-muted-foreground">速率限制</dt><dd data-source-breadcrumb="app-server.account/rateLimits/read">{rateLimits?.rateLimits.primary ? `${Math.round(rateLimits.rateLimits.primary.usedPercent)}% 已用` : '不可用'}</dd>
                </dl>
              )}

              {commandPanel === 'memory' && (
                <div className="space-y-3">
                  <button type="button" role="switch" aria-checked={useMemories} className="flex w-full items-center rounded-xl border px-3 py-3 text-left" onClick={() => setUseMemories((value) => !value)}>
                    <span><strong className="block text-sm">使用记忆</strong><span className="text-xs text-muted-foreground">应用于后续新任务</span></span>
                    <span className={cn('ml-auto h-6 w-10 rounded-full p-1', useMemories ? 'bg-primary' : 'bg-muted')}><span className={cn('block size-4 rounded-full bg-background transition-transform', useMemories && 'translate-x-4')} /></span>
                  </button>
                  <button type="button" role="switch" aria-checked={generateMemories} className="flex w-full items-center rounded-xl border px-3 py-3 text-left" onClick={() => setGenerateMemories((value) => !value)}>
                    <span><strong className="block text-sm">生成记忆</strong><span className="text-xs text-muted-foreground">允许当前任务创建新记忆</span></span>
                    <span className={cn('ml-auto h-6 w-10 rounded-full p-1', generateMemories ? 'bg-primary' : 'bg-muted')}><span className={cn('block size-4 rounded-full bg-background transition-transform', generateMemories && 'translate-x-4')} /></span>
                  </button>
                  <button type="button" className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground" onClick={() => {
                    void appServer.updateMemorySettings({ threadId: sessionId, useMemories, generateMemories }).then(() => setCommandPanel(null)).catch((error) => setCommandError(error instanceof Error ? error.message : String(error)));
                  }}>完成</button>
                </div>
              )}
            </div>
          )}

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
            accept={resolvedAttachmentsAccept}
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
            <FileReferenceCapsules
              paths={fileReferencePaths}
              onRemove={removeFileReference}
            />
            <FileExcerptCapsules
              excerpts={fileExcerptReferences}
              onRemove={removeFileExcerpt}
            />
            <AttachmentPendingTracker onChange={setAttachmentPendingTokens} />
            <DirectoryRefsCapsules
              paths={directoryRefs}
              onRemove={removeDirectoryRef}
              estimates={directoryRefEstimates}
            />

            <PromptInputBody>
              <PromptInputTextarea
                ref={textareaRef}
                pasteLongTextAsFile={codexOnly}
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
                    {installedPlugins.length > 0 && (
                      <div className="mt-2 border-t border-border/50 pt-2">
                        <div className="px-2.5 pb-1 text-xs font-semibold text-foreground">插件</div>
                        {installedPlugins.map((plugin) => (
                          <ComposerPlusMenuItem
                            key={plugin.uri}
                            icon={plugin.iconUrl
                              ? // eslint-disable-next-line @next/next/no-img-element
                                <img src={plugin.iconUrl} alt="" className="size-5 rounded object-contain" />
                              : <CodexWebIcon name="plugin" size={20} />}
                            label={plugin.label}
                            description={plugin.description}
                            onSelect={(event) => {
                              event.preventDefault();
                              addBadgeWithOrder({ command: plugin.name, label: plugin.label, description: plugin.description, kind: 'plugin', pluginUri: plugin.uri, pluginIconUrl: plugin.iconUrl });
                              setTimeout(() => textareaRef.current?.focus(), 0);
                            }}
                          />
                        ))}
                      </div>
                    )}
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
                <ContextWindowIndicator usage={contextWindowUsage} />
                <ComposerReasoningModelSelector
                  selectedEffort={selectedEffort}
                  onEffortChange={setSelectedEffort}
                  effortOptions={effortOptions}
                  currentModelOption={currentModelOption}
                  currentModelValue={currentModelValue}
                  currentProviderIdValue={currentProviderIdValue}
                  modelOptions={modelOptions}
                  onModelChange={onModelChange}
                  onProviderModelChange={onProviderModelChange}
                  persistLastModel={!codexOnly}
                  disabled={disabled}
                />
                <FileAwareSubmitButton
                  status={chatStatus}
                  onStop={onStop}
                  disabled={disabled}
                  inputValue={inputValue}
                  hasBadge={hasBadge}
                  hasContext={fileExcerptReferences.length > 0}
                />
              </div>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>

    </div>
  );
});
