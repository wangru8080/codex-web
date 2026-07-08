/**
 * Harness built-in tool side-channel event bus — cross-runtime.
 *
 * Originally introduced in Phase 5c (2026-05-16) under
 * `src/lib/codex/proxy/builtin-event-bus.ts` solely for the Codex
 * provider proxy path: bridge tools executing inside `streamText` had
 * no Responses-API slot for "the proxy already handled this tool,
 * here's the MediaBlock CodexWeb UI should render".
 *
 * Phase 5e Phase 0.5 P1 (2026-05-17, Native MediaBlock補齐) promotes
 * the bus to a cross-runtime harness primitive. The CodexWeb Native
 * Runtime hits the same wall: `builtin-tools/media.ts` returns plain
 * text from `execute()` (ai-sdk feeds the literal return value back to
 * the model), but the chat UI needs a MediaBlock with a
 * `localPath` / `mediaId` to render the image card inline. Stuffing
 * the MediaBlock into the model-visible return value is ugly (model
 * sees a base64-bearing JSON blob). Side-channel emit + listener
 * splice keeps the model-visible text clean while the UI gets the
 * structured MediaBlock.
 *
 * Wire:
 *   1. Each runtime subscribes with its `sessionId` BEFORE issuing the
 *      first tool call so events from early steps don't get dropped.
 *      - Codex Runtime: `CodexRuntime.stream()` → `subscribeBuiltinEvents`
 *      - Native Runtime: `agent-loop.ts` → `subscribeBuiltinEvents`
 *   2. Built-in tool `execute()` emits a `tool_completed`
 *      `RuntimeRunEvent` (and optionally `tool_started` for long-
 *      running ops) carrying any `MediaBlock[]` via this bus.
 *   3. The runtime listener splices the MediaBlock into its SSE
 *      `tool_result` event (Native) or pipes the canonical event
 *      directly via `canonicalToSseLine` (Codex).
 *
 * Contract points:
 *
 *   - Emit-before-subscribe is dropped. We don't buffer because a
 *     stale buffer carries cross-turn risk (last turn's image leaking
 *     into next turn's UI). The runtime always subscribes first.
 *   - Each session has its own bucket; sessions are independent.
 *   - Listener errors are caught + logged so a misbehaving renderer
 *     subscriber can't take down a tool's `execute()` loop.
 *   - `globalThis`-attached so different Next.js module graphs
 *     (proxy API route vs runtime module in Electron) share state.
 *     A plain module-level Map would create two buses in dev when
 *     Next hot-reloads only one of them.
 */

import type { RuntimeRunEvent } from '@/lib/runtime/contract';

interface Bus {
  subscribers: Map<string, Set<(event: RuntimeRunEvent) => void>>;
}

// Phase 5e (2026-05-17) — global key kept stable across the rename
// from `src/lib/codex/proxy/builtin-event-bus.ts`. Bumping it would
// orphan in-flight listeners during a hot-reload; keep as-is.
const GLOBAL_KEY = '__codepilotCodexBuiltinEventBus__' as const;

function getBus(): Bus {
  const g = globalThis as unknown as Record<string, Bus | undefined>;
  let bus = g[GLOBAL_KEY];
  if (!bus) {
    bus = { subscribers: new Map() };
    g[GLOBAL_KEY] = bus;
  }
  return bus;
}

/**
 * Subscribe a listener to events for a chat session.
 *
 * Returns an unsubscribe function. Multiple subscribers per session
 * are allowed (e.g. test harnesses can attach a probe alongside the
 * real runtime listener).
 */
export function subscribeBuiltinEvents(
  sessionId: string,
  listener: (event: RuntimeRunEvent) => void,
): () => void {
  if (!sessionId) {
    // Defensive: an empty sessionId would conflate runtime traffic
    // across chats. Surface as an immediate no-op + warn so the
    // caller fixes the wiring rather than getting silent cross-talk.
    console.warn('[harness.builtin-bus] subscribe called with empty sessionId — listener will never fire');
    return () => {};
  }
  const bus = getBus();
  let bucket = bus.subscribers.get(sessionId);
  if (!bucket) {
    bucket = new Set();
    bus.subscribers.set(sessionId, bucket);
  }
  bucket.add(listener);
  return () => {
    const current = bus.subscribers.get(sessionId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) bus.subscribers.delete(sessionId);
  };
}

/**
 * Emit an event to every listener attached to `sessionId`. If no
 * listener is attached, the event is dropped silently — DO NOT
 * buffer; see file-level contract note about cross-turn leakage.
 *
 * Listener exceptions are caught individually so one bad subscriber
 * can't stop other listeners from receiving the event AND can't take
 * down the bridge tool's `execute()` call.
 */
export function emitBuiltinEvent(sessionId: string, event: RuntimeRunEvent): void {
  if (!sessionId) return;
  const bus = getBus();
  const bucket = bus.subscribers.get(sessionId);
  if (!bucket || bucket.size === 0) return;
  for (const listener of bucket) {
    try {
      listener(event);
    } catch (err) {
      console.error('[harness.builtin-bus] listener threw — dropping for this dispatch only:', err);
    }
  }
}

/**
 * Test-only helper: clear every subscriber. Used to keep tests
 * hermetic when the same global bus instance is reused across them
 * (vitest / node:test isolate test files in process, but per-test
 * cleanup is still cheap insurance).
 */
export function __resetBuiltinEventBusForTests(): void {
  const bus = getBus();
  bus.subscribers.clear();
}

/** Test-only helper to assert listener counts without exporting internals. */
export function __subscriberCountForTests(sessionId: string): number {
  return getBus().subscribers.get(sessionId)?.size ?? 0;
}
