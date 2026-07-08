/**
 * RuntimeCapabilityList — Phase 5e Phase 3 (2026-05-18).
 *
 * Settings → Runtime page sub-component that surfaces the capability
 * clipboard for each Runtime. Per user decision (B-Settings variant)
 * this is the ONLY place CodexWeb tells the user "this engine
 * supports X but not Y — switch to Z to enable Y" — never a
 * chat-page banner.
 *
 * Phase 5e review round 7 (2026-05-18 user feedback) — UI reads
 * **user-facing copy** from `capability-display-text.ts`. The
 * `capability-contract.ts` strings (`displayName`,
 * `deferredReason`, `statusLine`) are engineering identifiers and
 * MUST NOT leak into Settings — words like "MCP" / "bridge not yet
 * implemented" / "permission round-trip design" / "Phase 5d slice 7"
 * are noise for the end user. The display layer keeps the user
 * vocabulary stable (生成 Widget / 看板操作 / ...) while the
 * engineering contract evolves underneath.
 *
 * Phase 5e review round 7 also:
 *   - Removes the underline on the trigger (per user request).
 *   - Removes the explicit footer "Close" button (Radix Dialog
 *     ships its own corner X close button per
 *     `src/components/ui/dialog.tsx:53` — having two close buttons
 *     was a "弹窗叠按钮" smell).
 *   - Adds a Codex Account header note when codex_account is the
 *     active provider: Codex’s own plugins / Skills are managed by
 *     Codex itself; the list below ONLY describes CodexWeb Harness
 *     injection, not Codex native capabilities.
 *
 * Design (sync'd with `docs/design.md` "Click-card → detail dialog"
 * spec):
 *   - Trigger: ghost-style text button, no underline. Sits inside
 *     the engine card (round 7 user request) so the affordance is
 *     part of the card, not a sibling row.
 *   - Dialog: `sm:max-w-2xl max-h-[85vh] flex flex-col gap-0
 *     overflow-hidden`. Header + scrollable body, no custom footer.
 *
 * Data source is **derived** from `capability-matrix.ts` which
 * derives from `capability-contract.ts`. The contract test in
 * `harness-capability-matrix.test.ts` guarantees every cell shown
 * comes from the catalog.
 */

'use client';

import { useState, type MouseEvent } from 'react';
import { CheckCircle, Circle, XCircle } from '@/components/ui/icon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { RuntimeId } from '@/lib/runtime/runtime-id';
import type { CapabilityMatrixCell } from '@/lib/harness/capability-matrix';
import {
  getCapabilityDisplay,
  buildUserReason,
  getCapabilityNote,
  CALLABLE_STATUS_LINE,
  CODEX_ACCOUNT_HEADER_NOTE,
  getUserExtensionsSummary,
  type UserExtensionsStatus,
} from '@/lib/harness/capability-display-text';

interface Props {
  readonly runtimeId: RuntimeId;
  readonly cells: readonly CapabilityMatrixCell[];
  readonly isZh: boolean;
  /** When the active default provider triggers a downgrade (e.g.
   *  codex_account on the Codex Runtime card), the parent passes a
   *  short sentence rendered inside the dialog header note slot. */
  readonly providerNote?: string;
  /** Round 7 user request — trigger lives inside the picker card.
   *  Clicking it must NOT bubble into the picker's "switch default
   *  runtime" handler. */
  readonly stopPropagationOnTrigger?: boolean;
}

function statusIcon(status: CapabilityMatrixCell['status']) {
  switch (status) {
    case 'executable':
      return <CheckCircle size={14} weight="fill" className="text-status-success-foreground" />;
    case 'perception_only':
      return <Circle size={14} className="text-status-warning-foreground" />;
    case 'unavailable':
      return <XCircle size={14} weight="fill" className="text-muted-foreground" />;
    case 'undetermined':
      return <Circle size={14} className="text-muted-foreground/60" />;
  }
}

function userExtensionsStatusIcon(status: UserExtensionsStatus) {
  switch (status) {
    case 'executable':
      return <CheckCircle size={14} weight="fill" className="text-status-success-foreground" />;
    case 'partial':
      // Same warning tone as perception_only — "some pieces work, some
      // don't" still means the user shouldn't expect every kind to be
      // callable here.
      return <Circle size={14} className="text-status-warning-foreground" />;
    case 'perception_only':
      return <Circle size={14} className="text-status-warning-foreground" />;
  }
}

function userExtensionsBadge(status: UserExtensionsStatus, isZh: boolean): { label: string; cls: string } {
  if (isZh) {
    switch (status) {
      case 'executable':
        return { label: '全部可用', cls: 'bg-status-success-muted text-status-success-foreground' };
      case 'partial':
        return { label: '部分可用', cls: 'bg-status-warning-muted text-status-warning-foreground' };
      case 'perception_only':
        return { label: '不可调用', cls: 'bg-status-warning-muted text-status-warning-foreground' };
    }
  }
  switch (status) {
    case 'executable':
      return { label: 'All wired', cls: 'bg-status-success-muted text-status-success-foreground' };
    case 'partial':
      return { label: 'Partial', cls: 'bg-status-warning-muted text-status-warning-foreground' };
    case 'perception_only':
      return { label: 'Not callable', cls: 'bg-status-warning-muted text-status-warning-foreground' };
  }
}

function statusLabel(status: CapabilityMatrixCell['status'], isZh: boolean): string {
  if (isZh) {
    switch (status) {
      case 'executable':
        return '可调用';
      case 'perception_only':
        return '不可调用';
      case 'unavailable':
        return '不支持';
      case 'undetermined':
        return '未确定';
    }
  }
  switch (status) {
    case 'executable':
      return 'Callable';
    case 'perception_only':
      return 'Not callable here';
    case 'unavailable':
      return 'Unsupported';
    case 'undetermined':
      return 'Undetermined';
  }
}

function trustBoundaryLabel(
  boundary: NonNullable<CapabilityMatrixCell['trustBoundary']>,
  isZh: boolean,
): string {
  if (isZh) {
    switch (boundary) {
      case 'auto_safe':
        return '自动执行';
      case 'requires_approval':
        return '需批准';
      case 'side_effect':
        return '会触发通知';
      case 'mixed':
        return '部分需批准';
    }
  }
  switch (boundary) {
    case 'auto_safe':
      return 'Auto';
    case 'requires_approval':
      return 'Approval';
    case 'side_effect':
      return 'Side effect';
    case 'mixed':
      return 'Mixed';
  }
}

function trustBoundaryClass(
  boundary: NonNullable<CapabilityMatrixCell['trustBoundary']>,
): string {
  switch (boundary) {
    case 'auto_safe':
      return 'bg-muted text-muted-foreground';
    case 'requires_approval':
      return 'bg-status-warning-muted text-status-warning-foreground';
    case 'side_effect':
      return 'bg-status-info-muted text-status-info-foreground';
    case 'mixed':
      return 'bg-status-warning-muted/60 text-status-warning-foreground';
  }
}

function runtimeLabel(runtimeId: RuntimeId, isZh: boolean): string {
  if (isZh) {
    switch (runtimeId) {
      case 'claude_code':
        return 'Claude Code';
      case 'codepilot_runtime':
        return 'CodexWeb';
      case 'codex_runtime':
        return 'Codex';
    }
  }
  switch (runtimeId) {
    case 'claude_code':
      return 'Claude Code';
    case 'codepilot_runtime':
      return 'CodexWeb';
    case 'codex_runtime':
      return 'Codex';
  }
}

export function RuntimeCapabilityList({
  runtimeId,
  cells,
  isZh,
  providerNote,
  stopPropagationOnTrigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const executableCount = cells.filter((c) => c.status === 'executable').length;
  const totalCount = cells.length;
  const lang: 'zh' | 'en' = isZh ? 'zh' : 'en';

  const handleTriggerClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagationOnTrigger) {
      // Round 7 — trigger is hosted inside the EnginePickerCard
      // click surface; without stopPropagation a click would both
      // open the dialog AND switch the default runtime.
      e.stopPropagation();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={handleTriggerClick}
          data-testid={`runtime-capability-trigger-${runtimeId}`}
          className={cn(
            'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px]',
            'text-muted-foreground hover:text-foreground hover:bg-muted/60',
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {isZh
            ? `查看能力清单（${executableCount} / ${totalCount}）`
            : `View capabilities (${executableCount} / ${totalCount})`}
        </button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 overflow-hidden"
        data-testid={`runtime-capability-dialog-${runtimeId}`}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {isZh ? '能力支持清单' : 'Capability support'} — {runtimeLabel(runtimeId, isZh)}
          </DialogTitle>
          <DialogDescription>
            {isZh
              ? `这里只展示 CodexWeb 提供的内置 Harness 能力。引擎自身的原生工具（例如 Codex 的 plugins / shell、ClaudeCode 的 hooks）由对应引擎管理，不在此列。`
              : `This list only covers CodexWeb’s built-in Harness capabilities. Each engine’s own native tools (Codex plugins / shell, ClaudeCode hooks, etc.) are managed by that engine and not shown here.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto mt-4 space-y-3">
          {providerNote && (
            <p
              data-testid={`provider-note-${runtimeId}`}
              className="text-[11px] leading-snug text-status-warning-foreground bg-status-warning-muted/60 rounded px-3 py-2"
            >
              {providerNote}
            </p>
          )}

          <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mt-1">
            {isZh ? 'CodexWeb 内置能力' : 'Built-in capabilities'}
          </h4>
          <ul className="flex flex-col gap-2">
            {cells.map((cell) => {
              const display = getCapabilityDisplay(cell.capabilityId);
              const label = display?.label[lang] ?? cell.capabilityId;
              const desc = display?.description?.[lang];
              const userStatusLine =
                cell.status === 'executable'
                  ? CALLABLE_STATUS_LINE[lang]
                  : buildUserReason({
                      capabilityId: cell.capabilityId,
                      currentRuntime: runtimeId,
                      suggestedRuntimes: cell.suggestedRuntime ? [cell.suggestedRuntime] : [],
                      lang,
                    });
              return (
                <li
                  key={cell.capabilityId}
                  data-testid={`capability-row-${runtimeId}-${cell.capabilityId}`}
                  data-status={cell.status}
                  data-trust-boundary={cell.trustBoundary ?? ''}
                  className="flex items-start gap-2.5 text-xs"
                >
                  <span className="shrink-0 mt-0.5">{statusIcon(cell.status)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          'font-medium leading-tight',
                          cell.status === 'executable' ? 'text-foreground' : 'text-foreground/70',
                        )}
                      >
                        {label}
                      </span>
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded tracking-wide',
                          cell.status === 'executable' && 'bg-status-success-muted text-status-success-foreground',
                          cell.status === 'perception_only' && 'bg-status-warning-muted text-status-warning-foreground',
                          cell.status === 'unavailable' && 'bg-muted text-muted-foreground',
                          cell.status === 'undetermined' && 'bg-muted text-muted-foreground',
                        )}
                      >
                        {statusLabel(cell.status, isZh)}
                      </span>
                      {cell.status === 'executable' && cell.trustBoundary && (
                        <span
                          data-testid={`trust-badge-${runtimeId}-${cell.capabilityId}`}
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded tracking-wide',
                            trustBoundaryClass(cell.trustBoundary),
                          )}
                        >
                          {trustBoundaryLabel(cell.trustBoundary, isZh)}
                        </span>
                      )}
                    </div>
                    {desc && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground/85 leading-snug">
                        {desc}
                      </p>
                    )}
                    {cell.status !== 'executable' && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                        {userStatusLine}
                      </p>
                    )}
                    {cell.noteKey && getCapabilityNote(cell.noteKey, lang) && (
                      <p
                        data-testid={`capability-note-${runtimeId}-${cell.capabilityId}`}
                        className="mt-0.5 text-[11px] text-muted-foreground leading-snug"
                      >
                        {getCapabilityNote(cell.noteKey, lang)}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Phase 5e round 8 (2026-05-18) — user-extensions section.
              Built-in capabilities above describe CodexWeb's first-
              party tools; this section describes whether user-defined
              MCP servers / Skills / slash commands / workspace rules
              are honored on the current Runtime. Kept as a separate
              section (not part of the matrix above) because user
              extensions are dynamic and outside the engineering
              HARNESS_CAPABILITIES catalog. */}
          {(() => {
            const summary = getUserExtensionsSummary(runtimeId);
            const badge = userExtensionsBadge(summary.status, isZh);
            return (
              <div className="mt-4 pt-3 border-t border-border/40">
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {isZh ? '用户自定义' : 'User extensions'}
                </h4>
                <div
                  data-testid={`user-extensions-row-${runtimeId}`}
                  data-status={summary.status}
                  className="mt-2 flex items-start gap-2.5 text-xs"
                >
                  <span className="shrink-0 mt-0.5">{userExtensionsStatusIcon(summary.status)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          'font-medium leading-tight',
                          summary.status === 'executable' ? 'text-foreground' : 'text-foreground/70',
                        )}
                      >
                        {summary.label[lang]}
                      </span>
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded tracking-wide',
                          badge.cls,
                        )}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/85 leading-snug">
                      {summary.description[lang]}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Standalone export for the Codex Account note so RuntimePanel can
 *  pick the right copy without importing the bilingual constant
 *  directly. */
export function codexAccountHeaderNote(isZh: boolean): string {
  return isZh ? CODEX_ACCOUNT_HEADER_NOTE.zh : CODEX_ACCOUNT_HEADER_NOTE.en;
}
