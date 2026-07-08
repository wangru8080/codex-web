/**
 * Run Checkpoint trust layer — the single source of truth for "Agent
 * is waiting for the user to confirm something before this send"
 * banners on the chat page.
 *
 * Active reasons (Round 1 + Round 2):
 *   - no-compatible-provider     — no provider can run the resolved pair
 *   - pinned-invalid             — Pinned default unreachable under runtime
 *   - runtime-fallback           — Claude Code SDK requested but Native in use
 *   - context-cost-change        — pending tokens crossed an attention threshold
 *
 * Full-access permission is confirmed ONCE at toggle time (the
 * ChatPermissionSelector AlertDialog) and shown by a persistent red chip; it is
 * NOT re-confirmed per send. An earlier `permission-elevation` checkpoint did
 * that and, via the /chat → /chat/[id] remount, re-fired on nearly every send
 * ("已了解，继续发送" each time — preview feedback). Removed 2026-06-02.
 *
 * Future rounds (see `docs/exec-plans/active/chat-run-checkpoint.md`)
 * will extend `CheckpointReasonId` with `dangerous-tool-call` (Round 3,
 * touches the tool-execution state machine).
 *
 * Design rules:
 *   - Banner only — never modal, never wizard, never settings toggle
 *   - One single primary action per banner
 *   - Returns [] when nothing's waiting → composer renders nothing
 *   - `requiresConfirm` reasons block the send until the action runs
 *
 * Pure data, no React. The component renders this list one-for-one.
 */

export type CheckpointReasonId =
  | 'no-compatible-provider'
  | 'pinned-invalid'
  | 'runtime-fallback'
  | 'context-cost-change';

export type CheckpointTone = 'error' | 'warning' | 'info';

/**
 * Action verbs the renderer understands. `'open-...'` ones map to a
 * settings hash navigation. `'confirm-...'` ones map to "complete the
 * pending send" — the calling page wires these to MessageInput's
 * imperative submit channel via the `onAction` prop on `<RunCheckpoint>`.
 */
export type CheckpointActionId =
  | 'open-providers'
  | 'open-runtime'
  | 'open-models'
  | 'confirm-context-cost';

export interface CheckpointAction {
  /** i18n key for the button label. Resolved by the renderer. */
  labelKey: string;
  /** 设置页跳转目标；Codex 专用版统一收敛到 Codex 设置页。 */
  href?: string;
  /** Optional explicit handler — wins over `href` if both provided. */
  onClick?: () => void;
  /** Action verb the calling page can intercept. Used for
   *  `confirm-...` reasons that don't navigate but unblock a
   *  pending send. */
  actionId?: CheckpointActionId;
}

export interface CheckpointReason {
  id: CheckpointReasonId;
  tone: CheckpointTone;
  /** i18n key for the title (always shown). */
  titleKey: string;
  /** i18n key for the description (optional). */
  descriptionKey?: string;
  /** Interpolation values for the description key. */
  descriptionValues?: Record<string, string | number>;
  /** Single primary action. Round 1 enforces "one action per banner"
   *  to keep the user's eye-path linear (see plan §B). */
  action?: CheckpointAction;
  /**
   * When true, MessageInput must block the send until the user takes
   * the banner's action. Round 2 added this for context-cost-change:
   * the reason gates the next message, the action button
   * confirms-and-sends. The other Round 1 reasons are informational +
   * already gate via `MessageInput.disabled` on other state, so they
   * don't set this flag.
   */
  requiresConfirm?: boolean;
}

export interface BuildCheckpointsOpts {
  /** Session-scoped: the picker couldn't resolve a provider/model
   *  pair under the active runtime. Always required because every
   *  RunCheckpoint surface needs to be able to express it. */
  noCompatibleProvider: boolean;
  /** Pinned-default invalid. Optional because chat first-paint surfaces
   *  use only the local runtime-aware resolver result here, and existing
   *  sessions ignore the global pin entirely. Settings / Health pages
   *  may still pass `true` from `useOverviewData().defaultInvalid` when
   *  surfacing global health. Defaults to `false`. */
  defaultInvalid?: boolean;
  /** Global "user asked for SDK but CLI fell back to native" notice.
   *  Optional because the chat surfaces dropped this signal entirely
   *  (it's global health, not session blocking — see
   *  `chat-static-graph.test.ts` for the contract). Settings / Health
   *  pages still drive it from `useOverviewData` + `useClaudeStatus`.
   *  Defaults to `false`. */
  runtimeFallback?: boolean;
  /** Human-readable "Anthropic / sonnet-4-5" for the pinned-invalid
   *  banner. Renderer interpolates into the description.
   *  Undefined → renders as "?" placeholder. */
  pinnedDescriptor?: string;
  /**
   * Round 2 — context-cost-change trigger inputs. `pendingContextTokens`
   * is the sum of @ mentions + + directories + PromptInput attachments.
   * `usedContextTokens` is what the model has already consumed in the
   * current session (from `useContextUsage().used`).
   * Defaults to 0 — page can omit when not on a session.
   */
  pendingContextTokens?: number;
  usedContextTokens?: number;
}

/** Pending tokens cap that always triggers the banner regardless of used. */
export const CONTEXT_COST_PENDING_HARD = 10_000;
/** Ratio of pending / used that triggers the banner when used > 0. */
export const CONTEXT_COST_PENDING_RATIO = 0.3;

/**
 * Whether the current pending vs used context tokens warrants the
 * "this send will add a lot of context" banner.
 *
 *   - pending >= 10K                                   → trigger
 *   - used > 0 AND pending / used >= 30%               → trigger
 *   - used === 0 AND pending < 10K                     → no trigger
 *     (no banner for tiny first-send context)
 *
 * Returns the *trigger* boolean — caller composes the reason itself.
 */
export function shouldTriggerContextCost(
  pendingContextTokens: number,
  usedContextTokens: number,
): boolean {
  if (pendingContextTokens >= CONTEXT_COST_PENDING_HARD) return true;
  if (usedContextTokens > 0 && pendingContextTokens / usedContextTokens >= CONTEXT_COST_PENDING_RATIO) {
    return true;
  }
  return false;
}

/**
 * Decide which checkpoints are active right now. Order in the returned
 * array determines render order — most blocking first.
 *
 * Precedence: noCompatibleProvider supersedes everything else because
 * if there's no provider at all, downstream reasons are noise. The
 * other reasons are additive — pinned-invalid + runtime-fallback +
 * context-cost can all stack if their triggers fire together.
 *
 * No reason currently sets `requiresConfirm`: they're all informational.
 * Round 1 (no-provider / pinned-invalid / runtime-fallback) rely on
 * MessageInput's existing `disabled` gate; Round 2 context-cost is a
 * non-blocking heads-up (v0.56.x #632 — an estimated context size must not
 * block a non-destructive send). The `requiresConfirm` + `blockingReasonIds`
 * + MessageInput bypass machinery is retained for any FUTURE real-danger
 * reason, but no built-in reason triggers it today.
 */
export function buildCheckpoints(opts: BuildCheckpointsOpts): CheckpointReason[] {
  const out: CheckpointReason[] = [];

  if (opts.noCompatibleProvider) {
    out.push({
      id: 'no-compatible-provider',
      tone: 'error',
      titleKey: 'runCheckpoint.noProvider.title',
      descriptionKey: 'runCheckpoint.noProvider.description',
      action: {
        labelKey: 'runCheckpoint.noProvider.action',
        href: '/settings/codex',
        actionId: 'open-providers',
      },
    });
    return out;
  }

  if (opts.defaultInvalid) {
    out.push({
      id: 'pinned-invalid',
      // Phase 6 UI收口 P0 (2026-05-14): pinned-invalid is a GLOBAL
      // warning about the user's default-model pin, NOT a per-session
      // blocker. The composer falls back to a runtime-compatible
      // (provider, model) pair and sends normally; this banner just
      // tells the user their default is in a degraded state with a
      // "fix default" jump link. Tone reflects that — warning, not
      // error — so the chat surface isn't lying about whether the
      // current send will work.
      tone: 'warning',
      titleKey: 'runCheckpoint.pinnedInvalid.title',
      descriptionKey: 'runCheckpoint.pinnedInvalid.description',
      descriptionValues: { pinned: opts.pinnedDescriptor || '?' },
      action: {
        labelKey: 'runCheckpoint.pinnedInvalid.action',
        href: '/settings/codex',
        actionId: 'open-models',
      },
    });
  }

  if (opts.runtimeFallback) {
    out.push({
      id: 'runtime-fallback',
      tone: 'warning',
      titleKey: 'runCheckpoint.runtimeFallback.title',
      descriptionKey: 'runCheckpoint.runtimeFallback.description',
      action: {
        labelKey: 'runCheckpoint.runtimeFallback.action',
        href: '/settings/codex',
        actionId: 'open-runtime',
      },
    });
  }

  // Round 2 — context-cost-change. v0.56.x #632 / Phase 2: this is a
  // NON-BLOCKING heads-up. The pending context size is an ESTIMATE; per the
  // plan, an estimated risk on a non-destructive, user-initiated send must not
  // be turned into a second confirm / send block. So NO `requiresConfirm` and
  // NO confirm action — it informs (info tone) but never enters
  // `blockingReasonIds`. Image / file attachments therefore send on the first
  // Enter. (The requiresConfirm + bypass machinery is retained for any FUTURE
  // real-danger reason — write / delete / exec / escalate — but none is active
  // now; those dangerous actions go through the permission system, not here.)
  const pending = opts.pendingContextTokens ?? 0;
  const used = opts.usedContextTokens ?? 0;
  if (shouldTriggerContextCost(pending, used)) {
    out.push({
      id: 'context-cost-change',
      tone: 'info',
      titleKey: 'runCheckpoint.contextCost.title',
      descriptionKey: 'runCheckpoint.contextCost.description',
      descriptionValues: {
        pending: formatTokensForBanner(pending),
        used: used > 0 ? formatTokensForBanner(used) : '0',
      },
    });
  }

  return out;
}

/** "12.3K" / "850" formatting — stays inline so unit tests can drive it. */
function formatTokensForBanner(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 100 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '')) + 'K';
  }
  return String(Math.round(n));
}
