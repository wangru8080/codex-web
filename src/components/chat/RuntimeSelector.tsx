'use client';

import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { CaretDown } from '@/components/ui/icon';
import { OpenAIIcon } from '@/components/icons/provider-icons';
import type { ChatRuntime } from '@/lib/chat-runtime-shared';

/**
 * Codex-only Web 版只允许聊天输入框选择 Codex Runtime。
 * 底层仍保留历史 runtime 类型用于旧会话读取和设置页兼容，但这里不再暴露切换入口。
 */
const CODEX_RUNTIME = 'codex_runtime' satisfies ChatRuntime;

const CODEX_RUNTIME_LABEL_KEYS = {
  label: 'runtimeSelector.codexRuntime' as TranslationKey,
  desc: 'runtimeSelector.codexRuntimeDesc' as TranslationKey,
};

function RuntimeIcon({ size, className }: { size: number; className?: string }) {
  return <OpenAIIcon size={size} className={className} />;
}

interface RuntimeSelectorProps {
  // The session's persisted `runtime_pin`. Empty string means the session
  // is following the global default (new sessions, or sessions whose
  // runtime hasn't been seeded yet by the chat route).
  runtimePin: string;
  // The currently effective runtime label — what would actually run if
  // the user pressed send right now. Used to render the trigger label
  // when `runtimePin === ''` so the user sees a concrete name instead
  // of a "follow default" hedge that doesn't tell them what's happening.
  effectiveRuntime: ChatRuntime;
  // Called with the new pin value. New chat (no sessionId yet) → caller
  // updates local state only. Existing session → caller PATCHes
  // `/api/chat/sessions/{id}` with `{ runtime_pin }`.
  onRuntimePinChange: (pin: ChatRuntime) => void;
  // Streaming guard: changing runtime mid-flight would either silently
  // fall through to the next message (confusing) or kill the active
  // stream (worse). Match ModeIndicator/ChatPermissionSelector — both
  // disable during stream.
  disabled?: boolean;
}

// Composer toolbar select for the session-level execution runtime.
// Visual language matches ModeIndicator + ChatPermissionSelector — invisible
// ghost button at default weight, hover surfaces the accent. The icon and
// label do the disambiguation; no colour cue.
export function RuntimeSelector({
  onRuntimePinChange,
  disabled,
}: RuntimeSelectorProps) {
  const { t } = useTranslation();
  const label = t(CODEX_RUNTIME_LABEL_KEYS.label);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          data-runtime-selector
          aria-label={t('runtimeSelector.triggerAria' as TranslationKey)}
          className={cn(
            'h-7 rounded-md text-xs font-normal text-muted-foreground',
          )}
        >
          <RuntimeIcon size={12} />
          <span>{label}</span>
          <CaretDown size={10} className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[260px]">
        <DropdownMenuItem
          onClick={() => onRuntimePinChange(CODEX_RUNTIME)}
          className="items-start py-2"
        >
          <RuntimeIcon size={14} className="mt-0.5" />
          <div className="flex flex-col items-start gap-0.5 flex-1 min-w-0">
            <span>{label}</span>
            <span className="text-[11px] text-muted-foreground leading-tight line-clamp-1 max-w-[200px]">
              {t(CODEX_RUNTIME_LABEL_KEYS.desc)}
            </span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
