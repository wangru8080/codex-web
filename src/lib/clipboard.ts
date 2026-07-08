/**
 * Clipboard helper with toast feedback. Centralises the await + catch
 * pattern that every "Copy …" entry in the app needs.
 *
 * Pre-fix (v11): three fire-and-forget call sites (UnifiedTopBar
 * `handleCopyId`, SessionListItem dropdown "复制对话 ID",
 * ProjectGroupHeader "Copy folder path") called
 * `navigator.clipboard.writeText(value)` and dropped the promise. In
 * Electron renderers the call rejects with `NotAllowedError` whenever
 * the document isn't focused (very common — DropdownMenu blurs the
 * page on click), and an unhandled promise rejection bubbles up as a
 * console error / Sentry report.
 *
 * Post-fix: every clipboard entry routes through `copyWithToast`,
 * which awaits + catches the rejection, surfaces a one-line toast
 * (success or warning with manual fallback), and ensures the rejection
 * never escapes to "uncaughtException" land.
 */

import { showToast } from '@/hooks/useToast';
import type { TranslationKey } from '@/i18n/en';

type Translator = (key: TranslationKey) => string;

export interface CopyWithToastOptions {
  /** Raw text to copy. */
  text: string;
  /** Bound `t` from `useTranslation()`. Required so toast strings are localised at the call site. */
  t: Translator;
  /**
   * Override the success / failure toast messages. By default we use
   * `common.copySuccess` / `common.copyFailed`. Pass per-entry keys if
   * the user-visible thing being copied warrants a more specific
   * message (e.g. "Conversation ID copied").
   */
  successMessageKey?: TranslationKey;
  failureMessageKey?: TranslationKey;
}

export async function copyWithToast(opts: CopyWithToastOptions): Promise<void> {
  const { text, t } = opts;
  const successKey: TranslationKey = opts.successMessageKey ?? ('common.copySuccess' as TranslationKey);
  const failureKey: TranslationKey = opts.failureMessageKey ?? ('common.copyFailed' as TranslationKey);
  try {
    await navigator.clipboard.writeText(text);
    showToast({ type: 'success', message: t(successKey) });
  } catch {
    // The reject types we see in practice (`NotAllowedError`,
    // `SecurityError`) all share the same user-fix: select-and-copy
    // by hand. Don't differentiate in the message — surface the raw
    // text so the user can grab it from the toast directly.
    showToast({ type: 'warning', message: `${t(failureKey)} ${text}` });
  }
}
