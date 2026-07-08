/**
 * Match a model id to a picker row by EITHER its UI alias (`value`, e.g. `opus`)
 * OR its canonical upstream id (`upstreamModelId`). The canonical form is
 * provider-shaped: OpenRouter uses the slug `anthropic/claude-opus-4.7`, while
 * direct Anthropic-skin / preset providers use `claude-opus-4-7` (dashes) — the
 * matcher handles both because it compares against whatever `upstreamModelId`
 * the row actually carries.
 *
 * On alias-keyed providers (OpenRouter, Anthropic-skin, …) the picker rows are
 * aliases (`opus`/`sonnet`/`haiku`) whose canonical id lives on
 * `upstreamModelId`. Many persisted sessions store the *canonical* id as their
 * `model` (e.g. real session `de19e576`: `anthropic/claude-opus-4.7` on
 * OpenRouter). Matching by `value` alone then fails to find
 * the row, and the picker / resolved-model / display logic silently drops to
 * the group's first model — a saved Opus chat reopens as Sonnet, the composer
 * auto-correct rewrites session state to Sonnet, and (because the auto-correct
 * feeds `useProviderModels`) the send path then sends Sonnet too (tech-debt
 * #37). Matching on either id makes the saved canonical id round-trip back to
 * its alias row. Returns undefined when nothing matches (callers fall back to
 * the group's first model / a raw label).
 *
 * Pure + provider-agnostic by design: it lives in `lib` (not in
 * `useProviderModels`) so every composer consumer — picker display, the
 * auto-correct effect, the run-status popover, the context-window upstream
 * lookup — can share ONE matcher and stay on the same canonical-aware contract,
 * without dragging the React hook / Settings data layer into the chat
 * first-paint graph (see `chat-static-graph.test.ts`).
 */
export function findModelOption<T extends { value: string; upstreamModelId?: string }>(
  options: readonly T[],
  modelId: string | undefined,
): T | undefined {
  if (!modelId) return undefined;
  return options.find((m) => m.value === modelId || m.upstreamModelId === modelId);
}

/**
 * Decide whether the composer's model auto-correct effect should rewrite the
 * current model, and to what. Returns the fallback model `value` to apply, or
 * `null` when no correction is needed.
 *
 * tech-debt #37: a RESOLVABLE model (matched by `value` OR canonical
 * `upstreamModelId`) must NOT be auto-corrected. The old value-only check
 * treated every canonical id (`claude-opus-4-7`) as missing and rewrote the
 * current model to the group's first model (Sonnet); because that state feeds
 * `useProviderModels`, it then made the send path send Sonnet — defeating the
 * `resolvedModel` round-trip. Only correct when the saved model genuinely isn't
 * in this provider's list (provider changed / removed), falling back to the
 * first model. Extracted as a pure function so this exact regression is unit
 * tested, not just source-pinned.
 */
export function resolveComposerModelAutoCorrect<T extends { value: string; upstreamModelId?: string }>(
  modelName: string | undefined,
  modelOptions: readonly T[],
): string | null {
  if (!modelName || modelOptions.length === 0) return null;
  // Resolvable by value OR canonical upstream → it IS available; leave it.
  if (findModelOption(modelOptions, modelName)) return null;
  // Genuinely absent from this provider's list → fall back to the first model.
  return modelOptions[0]?.value ?? null;
}
