/**
 * Harness Runtime Capability Adapter — Phase 5d Phase 3 (2026-05-17).
 *
 * ── What this module is ────────────────────────────────────────────
 *
 * Phase 2 gave us a pure `compileContext()` that turns a capability
 * set into a CompiledContext (system prompt + tool descriptors +
 * runtime hints + diagnostics).
 *
 * Phase 3 layers three thin runtime-specific facades on top so that
 * `claude-client.ts` / `builtin-tools/index.ts` /
 * `codex/proxy/unified-adapter.ts` don't each replicate the
 * "build a CompilerInput → call compileContext → unpack
 * runtimeHints / systemPromptText" boilerplate. Instead each runtime
 * consumes ONE adapter call and receives a typed result whose fields
 * match exactly what that runtime needs to mount tools + inject the
 * capability prompt:
 *
 *   - `adaptForClaudeCode({...})` →
 *     { systemPromptAppend, mcpServerNames, allowedToolNames, compiled }
 *   - `adaptForNative({...})` →
 *     { systemPromptText, toolSetKeys, compiled }
 *   - `adaptForCodexProxy({...})` →
 *     { systemPromptInstructions, builtinToolNames, stopWhen, stepCount, compiled }
 *
 * The adapter is a pure function (no IO, no DB, no provider calls);
 * it composes with the compiler's purity guarantee. Callers still
 * own gating + IO + MCP-server instance creation; the adapter only
 * answers "given this capability set, what does my runtime expose
 * to the model and how should I splice the prompt in?".
 *
 * ── What this module is NOT ────────────────────────────────────────
 *
 *   - It does NOT instantiate MCP servers / AI SDK tools / bridge
 *     tools. Those involve IO (workspace lookup, session id, event
 *     bus subscription) and live in their existing factories.
 *   - It does NOT make gating decisions. Whether `widget` is enabled
 *     for this turn is the caller's decision (keyword regex, mode,
 *     workspace presence). The adapter receives the resolved set.
 *   - It does NOT modify the original prompt or the request body.
 *     Callers splice `systemPromptAppend` / `systemPromptInstructions`
 *     into the data structures their SDK expects.
 *
 * ── Phase 2 review invariants this facade locks in ─────────────────
 *
 * The Phase 2 review surfaced two contract holes that have been
 * fixed in the runtime entry points; the adapter shape makes those
 * fixes structural rather than convention-only:
 *
 *   1. ClaudeCode / Native must inject the compiler prompt even when
 *      the upstream caller didn't supply a base systemPrompt. The
 *      adapter ALWAYS returns the compiled prompt string (empty
 *      string when there are no capabilities — never `null`).
 *      Callers can then `length > 0` check + mount the preset shape
 *      themselves without re-deriving "should I even build a
 *      systemPrompt object?".
 *   2. Native's `codepilot-media` group mounts BOTH the media-import
 *      tool AND the image-generation tool. The adapter accepts an
 *      `enabledCapabilities` set — callers map their group names to
 *      capability ids through `capabilityIdsForGroup` (which Phase 2
 *      P1-fixed to return both ids for `codepilot-media`). The
 *      adapter then trusts the set verbatim and produces matching
 *      tool descriptors + fragments. The unit tests pin the
 *      multi-id case so a future regression in the caller's mapping
 *      surface still trips a contract test, not just a smoke.
 */

import {
  compileContext,
  type CompiledContext,
  type ClaudeCodeHints,
  type NativeHints,
  type CodexProxyHints,
} from './context-compiler';
import {
  buildHarnessBundle,
  type UserHarnessExtension,
  type ExternalFrameworkHarnessRef,
  type HarnessBundle,
} from './harness-bundle';

// ─────────────────────────────────────────────────────────────────────
// Input shape (shared across all three runtime facades).
// ─────────────────────────────────────────────────────────────────────

export interface RuntimeAdapterInput {
  readonly sessionId: string;
  readonly workingDirectory?: string;
  readonly providerId: string;
  readonly model: string;
  /** Original user prompt. Compiler does not use it for gating today
   *  (caller pre-resolves `enabledCapabilities`), but the field is
   *  threaded into the compiler input for diagnostics. */
  readonly userPrompt: string;
  readonly enabledCapabilities: ReadonlySet<string>;
  /** Optional override. Default budget matches the per-runtime call
   *  sites pre-Phase-3 (100k systemPrompt / 200k context). */
  readonly tokenBudget?: {
    readonly systemPromptMax: number;
    readonly contextMax: number;
  };
  /** Phase 5e review fix P1 #2 (2026-05-18) — pre-scanned User
   *  CodexWeb Harness extensions (Settings MCP / project .mcp.json /
   *  CLAUDE.md / .claude/skills/ / .claude/commands/). When supplied
   *  the adapter renders a perception fragment into
   *  `systemPromptAppend` so the model sees the user's CodexWeb
   *  surface in addition to built-in capabilities. Caller produces
   *  this via `scanUserCodexWebExtensions()`. */
  readonly userExtensions?: readonly UserHarnessExtension[];
  /** Phase 5e review fix P1 #2 — pre-scanned External Framework
   *  Harness refs (`~/.claude/*`, `~/.codex/*`). Always rendered as
   *  perception (executable=true entries describe what the current
   *  Runtime can call; executable=false entries get a "switch to X
   *  Runtime" hint). Caller produces this via
   *  `scanExternalFrameworkExtensions()`. */
  readonly externalExtensions?: readonly ExternalFrameworkHarnessRef[];
}

const DEFAULT_TOKEN_BUDGET = {
  systemPromptMax: 100_000,
  contextMax: 200_000,
} as const;

/**
 * Phase 5e review round 3 fix P1 #A (2026-05-18) — render the
 * **HarnessBundle** extensions as a single perception fragment the
 * model can read.
 *
 * Pre-fix: this helper accepted raw `userExtensions` /
 * `externalExtensions` arrays directly and even backfilled a default
 * `perceptionHint` for non-executable entries that were missing one.
 * That bypassed the `buildHarnessBundle()` contract (which throws on
 * missing hint) and also skipped the bundle's diagnostics +
 * forceUnavailable handling. Result: adapters could render an
 * uncalibrated "Callable" section that disagreed with what the
 * bundle would have produced.
 *
 * Now the helper takes a `HarnessBundle` directly. The bundle is
 * built upstream by the adapters via `buildHarnessBundle()`, which
 * (a) throws on missing perceptionHint (no silent fallback), and
 * (b) populates diagnostics callers can audit. No default hints
 * here — if the bundle made it past the builder, every
 * non-executable entry already has a hint.
 *
 * Format:
 *
 *     ## Your harness extensions
 *
 *     Callable in this Runtime:
 *       - <user mcp server / skill / slash> (kind)
 *
 *     Perceptible only (not callable in this Runtime — switch to <X>
 *     to use):
 *       - <external ref> — <perceptionHint>
 *
 * Empty when both lists are empty so we don't waste prompt budget.
 * Returns '' (empty string) in that case so the caller can splice
 * unconditionally.
 */
export function renderHarnessExtensionFragment(bundle: HarnessBundle): string {
  const executable: string[] = [];
  const perception: string[] = [];

  for (const ext of bundle.userCapabilities) {
    if (ext.executable) {
      executable.push(`  - ${ext.displayName} (user ${ext.kind})`);
    } else {
      // Builder guarantees perceptionHint exists when executable=false;
      // we read it directly without a fallback. If a future refactor
      // weakens that builder contract, this throws via undefined string
      // concat rather than silently rendering "not callable".
      perception.push(
        `  - ${ext.displayName} (user ${ext.kind}) — ${ext.perceptionHint!}`,
      );
    }
  }

  for (const ref of bundle.externalExtensions) {
    if (ref.executable) {
      executable.push(`  - ${ref.displayName} (${ref.framework} ${ref.kind})`);
    } else {
      perception.push(
        `  - ${ref.displayName} (${ref.framework} ${ref.kind}) — ${ref.perceptionHint!}`,
      );
    }
  }

  if (executable.length === 0 && perception.length === 0) return '';

  const lines: string[] = ['## Your harness extensions', ''];
  if (executable.length > 0) {
    lines.push('Callable in this Runtime:');
    lines.push(...executable);
    lines.push('');
  }
  if (perception.length > 0) {
    lines.push(
      'Perceptible only (not callable in this Runtime — DO NOT pretend you can invoke them; the user knows they exist and can switch Runtime if needed):',
    );
    lines.push(...perception);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/**
 * Helper used by every facade — build the HarnessBundle from the
 * adapter input + render the extension fragment. Centralised so all
 * three runtime facades go through the same builder + render path
 * (no facade can skip the strong-validation builder).
 */
function buildBundleAndRender(
  input: RuntimeAdapterInput,
  runtimeId: 'claude_code' | 'codepilot_runtime' | 'codex_runtime',
): { bundle: HarnessBundle; fragment: string } {
  const bundle = buildHarnessBundle({
    runtimeId,
    providerId: input.providerId,
    attemptedCapabilities: input.enabledCapabilities,
    userCapabilities: input.userExtensions,
    externalExtensions: input.externalExtensions,
  });
  return { bundle, fragment: renderHarnessExtensionFragment(bundle) };
}

/**
 * Compose the final systemPromptAppend string: capability-compiled
 * text + (optional) harness extension perception fragment. Used by
 * all three runtime facades so the rendering is consistent.
 */
function composeSystemPromptWithExtensions(
  capabilityText: string,
  extFragment: string,
): string {
  if (!capabilityText && !extFragment) return '';
  if (!extFragment) return capabilityText;
  if (!capabilityText) return extFragment;
  return `${capabilityText}\n\n${extFragment}`;
}

// ─────────────────────────────────────────────────────────────────────
// ClaudeCode SDK adapter.
// ─────────────────────────────────────────────────────────────────────

export interface ClaudeCodeAdapterOutput {
  /** Capability system prompt text. Empty string when no live
   *  capabilities are enabled — caller can early-out instead of
   *  inspecting an Optional. Phase 2 P1 fix lives in `claude-client.ts`
   *  ~1048-1080: when this string is non-empty AND the upstream
   *  request did not supply a `systemPrompt`, the caller mounts the
   *  SDK preset shape with this string in the `append` slot. */
  readonly systemPromptAppend: string;
  /** Canonical MCP server names (from `BUILTIN_MCP_CATALOG` →
   *  capability-contract). Caller still instantiates the actual
   *  MCP server with its IO dependencies (workspace path, session
   *  id, event bus). */
  readonly mcpServerNames: readonly string[];
  /** Tool names the SDK should allow. Used by SDK
   *  `Options.allowedTools` when capability gating wants to be
   *  belt-and-suspenders on top of MCP registration. */
  readonly allowedToolNames: readonly string[];
  /** Full compiled context for diagnostics + advanced callers. */
  readonly compiled: CompiledContext;
}

export function adaptForClaudeCode(
  input: RuntimeAdapterInput,
): ClaudeCodeAdapterOutput {
  const compiled = compileContext({
    sessionId: input.sessionId,
    workingDirectory: input.workingDirectory,
    runtimeId: 'claude_code',
    providerId: input.providerId,
    model: input.model,
    userPrompt: input.userPrompt,
    enabledCapabilities: input.enabledCapabilities,
    tokenBudget: input.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
  });
  const hints: ClaudeCodeHints | undefined = compiled.runtimeHints.claudecode_sdk;
  // Phase 5e review round 3 fix P1 #A — bundle goes through
  // buildHarnessBundle() (strong-validation builder) before
  // rendering. No raw-array shortcut.
  const { fragment: extFragment } = buildBundleAndRender(input, 'claude_code');
  return {
    systemPromptAppend: composeSystemPromptWithExtensions(
      compiled.systemPromptText,
      extFragment,
    ),
    mcpServerNames: hints?.mcpServerNames ?? [],
    allowedToolNames: hints?.allowedToolNames ?? [],
    compiled,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Native (CodexWeb Runtime / AI SDK) adapter.
// ─────────────────────────────────────────────────────────────────────

export interface NativeAdapterOutput {
  /** Capability system prompt text. Caller pushes this onto its
   *  `systemPrompts: string[]` accumulator (non-capability groups
   *  like session-search / ask-user-question still get appended
   *  by the caller after this entry). */
  readonly systemPromptText: string;
  /** AI SDK ToolSet keys belonging to the enabled capabilities. */
  readonly toolSetKeys: readonly string[];
  readonly compiled: CompiledContext;
}

export function adaptForNative(
  input: RuntimeAdapterInput,
): NativeAdapterOutput {
  const compiled = compileContext({
    sessionId: input.sessionId,
    workingDirectory: input.workingDirectory,
    runtimeId: 'codepilot_runtime',
    providerId: input.providerId,
    model: input.model,
    userPrompt: input.userPrompt,
    enabledCapabilities: input.enabledCapabilities,
    tokenBudget: input.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
  });
  const hints: NativeHints | undefined = compiled.runtimeHints.native;
  // Phase 5e review round 3 fix P1 #A — bundle through builder.
  const { fragment: extFragment } = buildBundleAndRender(input, 'codepilot_runtime');
  return {
    systemPromptText: composeSystemPromptWithExtensions(
      compiled.systemPromptText,
      extFragment,
    ),
    toolSetKeys: hints?.toolSetKeys ?? [],
    compiled,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Codex Runtime (proxy bridge) adapter.
// ─────────────────────────────────────────────────────────────────────

export interface CodexProxyAdapterOutput {
  /** Capability system prompt text. Caller splices it into the
   *  Responses request body's `instructions` field (Phase 2 slice 2e
   *  +P0 fix in `unified-adapter.ts` ~155-162). Empty when no
   *  capabilities mounted — caller leaves body unmodified. */
  readonly systemPromptInstructions: string;
  /** Built-in tool names the bridge mounted; the unified adapter
   *  passes this to `translate-stream.ts` to suppress Codex-bound
   *  function_call events for these tools (bridge already executed
   *  them). */
  readonly builtinToolNames: ReadonlySet<string>;
  /** AI SDK multi-step ceiling. `stepCountIs` only when capabilities
   *  are mounted (bridge tools active); `never` for chat-only smoke
   *  runs so we don't surprise the pre-5c single-step legacy
   *  behaviour pinned in `codex-proxy-translators.test.ts`. */
  readonly stopWhen: 'stepCountIs' | 'never';
  /** Step ceiling (8 = empirical value pinned in
   *  `BUILTIN_BRIDGE_STEP_LIMIT` of `unified-adapter.ts`). */
  readonly stepCount: number;
  readonly compiled: CompiledContext;
}

export function adaptForCodexProxy(
  input: RuntimeAdapterInput,
): CodexProxyAdapterOutput {
  const compiled = compileContext({
    sessionId: input.sessionId,
    workingDirectory: input.workingDirectory,
    runtimeId: 'codex_runtime',
    providerId: input.providerId,
    model: input.model,
    userPrompt: input.userPrompt,
    enabledCapabilities: input.enabledCapabilities,
    tokenBudget: input.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
  });
  const hints: CodexProxyHints | undefined = compiled.runtimeHints.codex_proxy;
  // Phase 5e review round 3 fix P1 #A — bundle through builder.
  const { fragment: extFragment } = buildBundleAndRender(input, 'codex_runtime');
  return {
    systemPromptInstructions: composeSystemPromptWithExtensions(
      compiled.systemPromptText,
      extFragment,
    ),
    builtinToolNames: hints?.builtinToolNames ?? new Set<string>(),
    stopWhen: hints?.stopWhen ?? 'never',
    stepCount: hints?.stepCount ?? 0,
    compiled,
  };
}
