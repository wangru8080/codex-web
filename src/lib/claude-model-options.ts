/**
 * claude-model-options.ts — shared model-option sanitizer for Claude models.
 *
 * The Claude Agent SDK path (claude-client.ts) and the native/AI-SDK path
 * (agent-loop.ts) both assemble thinking / effort / context1m options for
 * Anthropic requests. Without a shared sanitizer, breaking-change guards
 * have to be duplicated across paths and drift (which is exactly what Codex
 * flagged in the Opus 4.7 review).
 *
 * Scope for the Opus 4.7+ adaptive-thinking family (4.7, 4.8, and Fable 5,
 * per the official migration guides — they share the same request contract;
 * Fable 5 additionally cannot turn thinking off AT ALL — adaptive thinking
 * runs even when the param is omitted; see FABLE_PATTERN note below):
 *   - These models do NOT accept manual extended thinking
 *     ({ type: 'enabled', budgetTokens }) — returns 400. Convert to adaptive.
 *   - They support adaptive thinking + effort-based reasoning budget.
 *     (Display=summarized can be added by callers separately.)
 *   - 1M context is the default — context-1m-2025-08-07 beta header is
 *     unnecessary and gets skipped.
 *
 * NOTE on effort DEFAULT (4.7 → xhigh, 4.8 → high): that per-model default
 * is applied by the Claude Code CLI / SDK when `effort` is left unset (see
 * claude-client.ts ~1193), NOT here. This sanitizer only normalizes thinking
 * + the context-1m beta; it passes `effort` through untouched.
 */

export type ThinkingConfig =
  | { type: 'adaptive'; display?: 'summarized' | 'omitted' }
  | { type: 'enabled'; budgetTokens?: number; display?: 'summarized' | 'omitted' }
  | { type: 'disabled' };

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ClaudeModelOptionsInput {
  /** Upstream / full model ID (e.g. 'claude-opus-4-7'). Short aliases like
   *  'opus' are not detected as 4.7 — callers should resolve to upstream
   *  before sanitizing. */
  model: string | undefined;
  thinking?: ThinkingConfig;
  effort?: EffortLevel | string;
  context1m?: boolean;
}

export interface ClaudeModelOptionsOutput {
  thinking?: ThinkingConfig;
  effort?: string;
  /** After sanitization, whether the caller should attach the
   *  context-1m-2025-08-07 beta header. Opus 4.7 is 1M by default and
   *  returns true only for models that still need the beta. */
  applyContext1mBeta: boolean;
  /** Whether the input model is in the Opus 4.7+ adaptive-thinking family
   *  (4.7 / 4.8). Exposed so callers can log or make additional
   *  runtime-specific decisions. */
  isOpusAdaptiveThinking: boolean;
  /** True when the caller asked for thinking:'disabled' on a model where
   *  thinking cannot be turned off (Fable 5: an explicit 'disabled' 400s
   *  AND an omitted param still runs adaptive thinking). The sanitized
   *  request omits the param to stay wire-valid, but the user's "thinking
   *  off" choice is NOT honored — callers MUST surface this (one-shot
   *  notification), never swallow it silently. */
  thinkingForcedOn: boolean;
}

// Opus 4.7 and 4.8 share the adaptive-thinking contract (no manual extended
// thinking; 1M context by default). Add future same-family versions to the
// `[78]` character class. Matches BOTH the dash upstream (`claude-opus-4-8`,
// first-party) and the dotted slug (`anthropic/claude-opus-4.8`, OpenRouter):
// OpenRouter currently routes via the OpenAI SDK, but a future Anthropic-skin
// / provider override could send the dotted form here, so we don't rely on
// that assumption (Codex review P2, 2026-05-29).
const OPUS_ADAPTIVE_THINKING_PATTERN = /opus-?4[-.]?[78]/i;

// Fable 5 (claude-fable-5, 2026-06 launch) shares the Opus 4.7/4.8 request
// contract (sampling params removed; 1M default) with ONE extra breaking
// change per the official migration guide: thinking CANNOT be turned off.
// "Adaptive thinking is the only thinking mode on claude-fable-5 ...
// thinking: {type: 'disabled'} returns an error. On Claude Opus 4.8,
// requests without a thinking field run without thinking; on
// claude-fable-5, those requests run with adaptive thinking."
// So omitting the param avoids the 400 but does NOT mean "thinking off" —
// callers must surface that via `thinkingForcedOn` (Codex review P1,
// 2026-06-10). Matches `claude-fable-5`, `fable-5`, and tagged variants
// like `claude-fable-5[1m]`.
const FABLE_PATTERN = /fable-?5/i;

export function isFableModel(model: string | undefined): boolean {
  if (!model) return false;
  return FABLE_PATTERN.test(model);
}

export function isOpusAdaptiveThinkingModel(model: string | undefined): boolean {
  if (!model) return false;
  // Fable 5 is in the same adaptive-thinking family — every 4.7+ guard
  // (enabled→adaptive conversion, no context-1m beta) applies to it too.
  return OPUS_ADAPTIVE_THINKING_PATTERN.test(model) || FABLE_PATTERN.test(model);
}

/**
 * Normalize thinking / effort / context1m for a single Anthropic request.
 * Idempotent — safe to call multiple times on the same input.
 */
export function sanitizeClaudeModelOptions(
  input: ClaudeModelOptionsInput,
): ClaudeModelOptionsOutput {
  const isOpusAdaptiveThinking = isOpusAdaptiveThinkingModel(input.model);

  let thinking = input.thinking;
  let thinkingForcedOn = false;
  if (isOpusAdaptiveThinking && thinking) {
    // Opus 4.7+ reject manual extended thinking. Convert to adaptive so
    // the user's "thinking enabled" intent survives without triggering
    // a 400.
    if (thinking.type === 'enabled') {
      thinking = { type: 'adaptive', display: 'summarized' };
    } else if (thinking.type === 'adaptive' && !thinking.display) {
      // Adaptive thinking defaults display to 'omitted', which means the
      // SDK will not emit thinking deltas and CodexWeb's reasoning block
      // disappears. Explicitly request 'summarized' so users still see the
      // reasoning UI they saw on 4.6.
      thinking = { ...thinking, display: 'summarized' };
    } else if (thinking.type === 'disabled' && isFableModel(input.model)) {
      // Fable 5: thinking cannot be turned off. An explicit
      // { type: 'disabled' } returns 400, and a request WITHOUT a thinking
      // field still runs adaptive thinking (official migration guide).
      // Omitting is the only wire-valid shape, but it is NOT "thinking
      // off" — flag it so callers tell the user instead of silently
      // misrepresenting their choice.
      thinking = undefined;
      thinkingForcedOn = true;
    }
  }

  // Opus 4.7+ ship 1M by default — the beta header is unnecessary and
  // kept out to make regression hunting cleaner.
  const applyContext1mBeta = !!input.context1m && !isOpusAdaptiveThinking;

  return {
    thinking,
    effort: input.effort as string | undefined,
    applyContext1mBeta,
    isOpusAdaptiveThinking,
    thinkingForcedOn,
  };
}
