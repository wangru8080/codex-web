/**
 * Shared runtime resolution helpers — single source of truth for two
 * questions that previously had three different answers across the
 * codebase:
 *
 *   1. Given the stored `agent_runtime` + `cli_enabled` settings, which
 *      runtime is actually selected? (Settings > Runtime panel +
 *      RuntimeBadge in chat header + future Run Cockpit.)
 *
 *   2. Given the runtime-filtered `/api/providers/models?runtime=auto`
 *      result and the user's global default pair (+ optionally
 *      localStorage saved pair), which provider/model would a fresh
 *      chat actually pick at init?
 *
 * Without these helpers the three call sites had drifted:
 *   - `registry.ts:resolveRuntime` correctly applied `cli_enabled=false`
 *     as the highest-priority override
 *   - `RuntimeBadge` ignored `cli_enabled` and just read `agent_runtime`
 *   - `RuntimePanel` originally read `cli_enabled` only into state, not
 *     into the displayed selection
 *   - `chat/page` did `globalPair → providerOnly → savedPair → first`
 *     while `RuntimePanel` did `globalPair → providerOnly → first`
 *     (skipping the saved-pair retry — divergent for users with a
 *     valid global model that happened to be filtered out by runtime
 *     compat)
 *
 * Keep these pure: no `fetch`, no React, no DOM. Each caller fetches
 * their inputs and feeds them in.
 */

import { resolveLegacyRuntimeForDisplay } from "./legacy";

// Phase 5 Phase 6 IA correction (2026-05-14) — three-engine union. Codex
// Runtime joins as a peer of Claude Code and CodexWeb Runtime; Settings →
// Runtime now offers it as a global default and the chat header badge can
// surface "Codex Runtime" directly.
export type AgentRuntime = "claude-code-sdk" | "native" | "codex_runtime";

/** Engine label used in user-facing strings. Settings page maps it to
 *  zh/en + an optional fallback annotation; just produces the canonical
 *  spelling here.
 *
 *  Phase 6 UI收口 P1 fix-up (2026-05-14) — short names. "AI SDK" is an
 *  internal implementation detail (users don't pick "an SDK"); the
 *  product label is "CodexWeb". Similarly "Codex Runtime" drops the
 *  redundant suffix to match the engine picker / composer / detail
 *  card heading. Three engines, three short names. */
export function runtimeDisplayLabel(runtime: AgentRuntime): "Claude Code" | "CodexWeb" | "Codex" {
  if (runtime === "claude-code-sdk") return "Claude Code";
  if (runtime === "codex_runtime") return "Codex";
  return "CodexWeb";
}

/**
 * Compute the *effective* runtime — what the chat path will actually
 * route to. Mirrors the priority chain in `registry.ts:resolveRuntime`:
 *
 *   1. `cli_enabled === false` → 'native' (highest-priority constraint)
 *   2. Stored `agent_runtime` if available — but **availability is
 *      checked**: if the user picked `'claude-code-sdk'` and the CLI
 *      isn't currently connected, fall through to native (matches
 *      `registry.ts` line 67-68 where `r?.isAvailable()` gates the
 *      explicit setting).
 *   3. Auto / legacy / null → coerce to whichever concrete runtime
 *      matches the current CLI state.
 *
 * `agent_runtime='auto'` (legacy) is coerced via
 * `resolveLegacyRuntimeForDisplay`. Callers that already store
 * concrete values can pass them through unchanged.
 *
 * Why availability matters: without this check the badge in the chat
 * header could read "Claude Code" while the chat actually ran on AI
 * SDK because `sdk.isAvailable()` returned false in the registry.
 * Three surfaces (Settings panel, chat badge, registry) MUST agree.
 *
 * @param storedAgentRuntime  raw value from `settings.agent_runtime` —
 *   may be `'claude-code-sdk'` / `'native'` / `'auto'` (legacy) / null.
 * @param cliEnabled  raw value from `settings.cli_enabled`. Stored as
 *   string `'true' | 'false'`; the helper accepts both string and
 *   boolean for caller convenience. `null` / `undefined` defaults to
 *   enabled.
 * @param cliConnected  whether Claude Code CLI is currently detected.
 *   Used both to disambiguate legacy `'auto'` AND to gate the explicit
 *   `'claude-code-sdk'` choice — same as registry.
 */
export function computeEffectiveRuntime(
  storedAgentRuntime: string | null | undefined,
  cliEnabled: boolean | string | null | undefined,
  cliConnected: boolean,
): AgentRuntime {
  // Coerce cli_enabled to boolean. DB stores it as a string `'true' |
  // 'false'`; React state usually has it as a boolean. `null` /
  // `undefined` defaults to enabled (back-compat with rows that predate
  // the column).
  const cliEnabledBool =
    typeof cliEnabled === "boolean"
      ? cliEnabled
      : cliEnabled !== "false";

  // Phase 5 Phase 6 IA correction (2026-05-14) — codex_runtime is its
  // own engine and never falls back. Codex Account models can ONLY
  // run on the Codex app-server; ClaudeCode SDK / Native can't speak
  // its wire format. So if the user pinned Codex Runtime as global
  // default, we report it as the effective runtime even when the
  // codex binary is missing — the send-time guardrail in
  // claude-client.ts surfaces a clear "Codex Runtime is not
  // available — install codex CLI" error rather than silently
  // routing GPT-5.5 through Claude Code SDK (Round 5 fail-closed).
  if (storedAgentRuntime === "codex_runtime") return "codex_runtime";

  // cli_enabled=false is the highest-priority override for the two
  // legacy engines. Even if the user's stored preference is Claude
  // Code, this short-circuits to AI SDK because the registry won't
  // spawn the CLI subprocess. Codex is unaffected — its app-server
  // is its own subprocess, independent of cli_enabled.
  if (!cliEnabledBool) return "native";

  // Stored `'native'` is always available (it's bundled). Stored
  // `'claude-code-sdk'` requires the CLI to be present — same gate as
  // registry's `r?.isAvailable()`. A user who chose Claude Code but
  // doesn't have CLI installed is functionally on AI SDK, not Claude
  // Code; the badge / explainer must reflect that.
  if (storedAgentRuntime === "native") return "native";
  if (storedAgentRuntime === "claude-code-sdk") {
    return cliConnected ? "claude-code-sdk" : "native";
  }

  // Legacy `'auto'` or `null` — coerce to whichever concrete runtime
  // matches the current CLI state.
  return resolveLegacyRuntimeForDisplay(storedAgentRuntime, cliConnected) as AgentRuntime;
}

// ---------------------------------------------------------------------------
// New-chat default resolver — Phase 2C contract
// ---------------------------------------------------------------------------
//
// The Phase 2C principle: *Pinned default is a hard promise — Auto is the
// only mode allowed to fallback.* The resolver returns a tagged status so
// callers can enforce that:
//
//   - 'ok'              Pinned mode resolved cleanly to provider+model.
//   - 'auto-resolved'   Auto mode found something via the fallback chain.
//   - 'invalid-default' Pinned mode, but the pinned target isn't reachable
//                       under the current Runtime. **Callers MUST NOT
//                       silently substitute another provider/model.** They
//                       must surface the state and block sends until the
//                       user resolves it (recovery actions live in 2C.3
//                       Runtime banner / 2C.5 Health page).
//   - 'no-compatible'   Empty `groups`; no compatible provider at all.
//                       Higher-priority than mode — even Pinned with a
//                       valid pin returns this when groups is empty.

/** Status tag for the resolver's return value. See file header. */
export type NewChatDefaultStatus =
  | "ok"
  | "auto-resolved"
  | "invalid-default"
  | "no-compatible";

/**
 * Why a Pinned default is invalid. Drives the Runtime banner copy + which
 * recovery action is most prominent.
 *
 * - `'provider-missing'` — pinned provider isn't in the runtime-filtered
 *   group list. Most likely the user pinned an OpenAI model but is on
 *   Claude Code Runtime (or vice versa).
 * - `'model-missing'` — pinned provider IS reachable but the pinned model
 *   isn't in its filtered list (model disabled / filtered out by runtime
 *   compat).
 * - `'pin-incomplete'` — defensive: storage somehow has mode='pinned' but
 *   one of provider/model is empty. Shouldn't happen post-migration but
 *   we surface it instead of silently coercing to Auto.
 */
export type InvalidDefaultReason =
  | "provider-missing"
  | "model-missing"
  | "pin-incomplete";

export interface NewChatDefaultResolution {
  status: NewChatDefaultStatus;
  /** Resolved provider id. Present for 'ok' / 'auto-resolved'. May be
   *  present for 'invalid-default' to expose the user's pinned choice
   *  (so the banner can name what's broken). */
  providerId?: string;
  providerName?: string;
  modelValue?: string;
  modelLabel?: string | null;
  /** Reason — only meaningful when status === 'invalid-default'. */
  reason?: InvalidDefaultReason;
}

interface ProviderGroup {
  provider_id: string;
  provider_name: string;
  models: Array<{ value: string; label: string }>;
}

export interface NewChatResolveInput {
  /** The runtime-filtered groups from `/api/providers/models?runtime=auto`. */
  groups: ProviderGroup[];
  /** Default mode — Phase 2C contract. 'pinned' enforces an exact match
   *  against `pinnedProviderId` + `pinnedModel`; 'auto' walks the
   *  fallback chain (savedPair → apiDefault → first). */
  mode: "auto" | "pinned";
  /** User's committed pinned provider — required when mode='pinned'. */
  pinnedProviderId?: string;
  /** User's committed pinned model — required when mode='pinned'. */
  pinnedModel?: string;
  /** Server-suggested default provider id (response's `default_provider_id`
   *  field). Used as a fallback in Auto mode; ignored in Pinned mode. */
  apiDefaultProviderId?: string;
  /** Per-tab last-used pair (chat/page reads this from localStorage).
   *  Used in Auto mode only. */
  savedProviderId?: string;
  savedModel?: string;
}

/**
 * Resolve which provider/model a new chat should use.
 *
 * Pinned mode (status: 'ok' | 'invalid-default'):
 *   Exact match against `pinnedProviderId` + `pinnedModel` in the filtered
 *   groups. Anything missing → 'invalid-default' with a reason. **No
 *   fallback chain** — that's the entire point of pinning.
 *
 * Auto mode (status: 'auto-resolved'):
 *   Fallback chain:
 *     1. Saved (localStorage) pair, validated.
 *     2. Saved provider with first available model.
 *     3. API-suggested default provider, first model.
 *     4. First compatible group, first model.
 *   Stored pinned values are intentionally ignored — Auto means Auto.
 *
 * Empty groups always returns 'no-compatible' regardless of mode.
 */
export function resolveNewChatDefault(input: NewChatResolveInput): NewChatDefaultResolution {
  if (input.groups.length === 0) {
    return { status: "no-compatible" };
  }
  if (input.mode === "pinned") {
    return resolvePinned(input.groups, input.pinnedProviderId, input.pinnedModel);
  }
  return resolveAuto(
    input.groups,
    input.apiDefaultProviderId,
    input.savedProviderId,
    input.savedModel,
  );
}

function resolvePinned(
  groups: ProviderGroup[],
  pinnedProviderId: string | undefined,
  pinnedModel: string | undefined,
): NewChatDefaultResolution {
  if (!pinnedProviderId || !pinnedModel) {
    return {
      status: "invalid-default",
      providerId: pinnedProviderId,
      modelValue: pinnedModel,
      reason: "pin-incomplete",
    };
  }
  const targetGroup = groups.find((g) => g.provider_id === pinnedProviderId);
  if (!targetGroup) {
    return {
      status: "invalid-default",
      providerId: pinnedProviderId,
      modelValue: pinnedModel,
      reason: "provider-missing",
    };
  }
  const modelInGroup = targetGroup.models.find((m) => m.value === pinnedModel);
  if (!modelInGroup) {
    return {
      status: "invalid-default",
      providerId: targetGroup.provider_id,
      providerName: targetGroup.provider_name,
      modelValue: pinnedModel,
      reason: "model-missing",
    };
  }
  return {
    status: "ok",
    providerId: targetGroup.provider_id,
    providerName: targetGroup.provider_name,
    modelValue: modelInGroup.value,
    modelLabel: modelInGroup.label,
  };
}

function resolveAuto(
  groups: ProviderGroup[],
  apiDefaultProviderId: string | undefined,
  savedProviderId: string | undefined,
  savedModel: string | undefined,
): NewChatDefaultResolution {
  if (savedProviderId) {
    const savedGroup = groups.find((g) => g.provider_id === savedProviderId);
    if (savedGroup) {
      const savedModelInGroup = savedModel
        ? savedGroup.models.find((m) => m.value === savedModel)
        : undefined;
      if (savedModelInGroup) {
        return {
          status: "auto-resolved",
          providerId: savedGroup.provider_id,
          providerName: savedGroup.provider_name,
          modelValue: savedModelInGroup.value,
          modelLabel: savedModelInGroup.label,
        };
      }
      if (savedGroup.models?.length) {
        const first = savedGroup.models[0];
        return {
          status: "auto-resolved",
          providerId: savedGroup.provider_id,
          providerName: savedGroup.provider_name,
          modelValue: first.value,
          modelLabel: first.label,
        };
      }
    }
  }
  const apiDefault = apiDefaultProviderId
    ? groups.find((g) => g.provider_id === apiDefaultProviderId)
    : undefined;
  const fallbackGroup = apiDefault ?? groups[0];
  const firstModel = fallbackGroup.models[0];
  return {
    status: "auto-resolved",
    providerId: fallbackGroup.provider_id,
    providerName: fallbackGroup.provider_name,
    modelValue: firstModel?.value ?? "",
    modelLabel: firstModel?.label ?? null,
  };
}
