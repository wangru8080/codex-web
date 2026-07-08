/**
 * chat-runtime — server-side runtime resolver helpers (read DB
 * setting, walk the runtime registry, etc.).
 *
 * The **pure** pieces — `ChatRuntime` type, `ChatRuntimeParam` type,
 * `isChatRuntimeParam`, `chatRuntimeParamForSession` — live in
 * `chat-runtime-shared.ts` so client components can import them
 * without dragging Node-only deps (`async_hooks`, Sentry, etc.) into
 * the browser bundle. This file re-exports them so server callers
 * keep working unchanged.
 *
 * Why this exists separately from `runtime/registry`:
 *   `runtime/registry` returns the concrete agent runtime id used to
 *   spawn the SDK subprocess (`'claude-code-sdk'` / `'native'`). The chat
 *   picker / Models page / provider-resolver want a label that matches
 *   `ModelRuntimeCompat`'s `claude_code_compatible` / `codepilot_runtime_compatible`
 *   flags so filtering reads naturally. This module is the translation
 *   layer; everything else uses these labels.
 *
 * Consumers:
 *   - `/api/providers/models?runtime=auto`  — server resolves + filters
 *   - `provider-resolver.resolveProvider({ runtime })` — gates default-model
 *     selection alongside the existing hidden-id guard
 *   - `useProviderModels({ runtime: 'auto' })` — chat picker hook passes
 *     'auto' through and lets the server decide
 */

// Import from `./runtime` (the barrel index), NOT `./runtime/registry`
// directly. The barrel performs `registerRuntime(nativeRuntime)` and
// `registerRuntime(sdkRuntime)` as import-time side effects; pulling
// resolveRuntime from `./runtime/registry` skips that registration and
// makes resolveRuntime() throw "No agent runtime registered" on any
// caller that hasn't already imported the barrel transitively.
//
// This bit `/api/providers/models?runtime=auto` (500 in dev): the route
// only imports chat-runtime, not the barrel, so the registry was empty
// when getActiveChatRuntime() fired. Routing every consumer through the
// barrel guarantees registration before resolution.
import { resolveRuntime } from './runtime';
import type { ChatRuntime, ChatRuntimeParam } from './chat-runtime-shared';

// Re-export pure pieces so server-side callers that already import
// from `@/lib/chat-runtime` keep compiling. New client-side callers
// must import directly from `chat-runtime-shared` (this file's
// `resolveRuntime` import would still pull Node deps into a client
// bundle).
export type { ChatRuntime, ChatRuntimeParam } from './chat-runtime-shared';
export { isChatRuntimeParam, chatRuntimeParamForSession } from './chat-runtime-shared';

/**
 * Server-side: read `agent_runtime` setting + CLI binary availability via
 * the runtime registry, then map the concrete runtime to a chat-side label.
 *
 * Same resolution chain as `streamClaude` in `claude-client.ts`, so the
 * picker / resolver agree with what actually spawns.
 */
export function getActiveChatRuntime(): ChatRuntime {
  const concrete = resolveRuntime();
  // Phase 5 Phase 3 (2026-05-13) — Codex Runtime registry id matches
  // the canonical RuntimeId verbatim, so we can return it directly.
  // The earlier two-runtime world mapped 'claude-code-sdk' →
  // 'claude_code' and everything else → 'codepilot_runtime'.
  if (concrete.id === 'codex_runtime') return 'codex_runtime';
  if (concrete.id === 'claude-code-sdk') return 'claude_code';
  return 'codepilot_runtime';
}

/**
 * Resolve a query-string runtime to a concrete `ChatRuntime`. Pass-through
 * for explicit values; `'auto'` triggers server-side resolution.
 */
export function resolveChatRuntimeParam(param: ChatRuntimeParam): ChatRuntime {
  return param === 'auto' ? getActiveChatRuntime() : param;
}

/**
 * Phase 2 Step 2: session-aware variant of `getActiveChatRuntime`.
 *
 * If the session record carries a non-empty `runtime_pin`, that value
 * wins regardless of the current global `agent_runtime` setting — the
 * user's per-session commitment is a stronger signal than a global
 * default the user may have changed for unrelated reasons (e.g. they
 * connected a new provider in another chat).
 *
 * Empty / undefined / unknown pin → fall through to the global path
 * (`getActiveChatRuntime()`). This preserves the today-default
 * behavior for any session created before the column existed (every
 * legacy row has `runtime_pin = ''`) and for new chats the user
 * hasn't explicitly pinned.
 *
 * Step 3+ will plumb `session` into the chat send route and the
 * picker hook so they call this wrapper instead of the global one.
 * Today nothing reads it except the immunity tests — this is the
 * data-plane prerequisite that makes the migration possible.
 */
export function resolveRuntimeForSession(session: { runtime_pin?: string }): ChatRuntime {
  const pin = session.runtime_pin;
  // Phase 5 Phase 3 (2026-05-13) — codex_runtime is now a valid pin too.
  if (pin === 'claude_code' || pin === 'codepilot_runtime' || pin === 'codex_runtime') {
    return pin;
  }
  return getActiveChatRuntime();
}
