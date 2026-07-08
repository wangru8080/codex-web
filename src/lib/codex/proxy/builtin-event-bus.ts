/**
 * @deprecated 2026-05-17 — moved to `@/lib/harness/builtin-event-bus`
 * (Phase 5e Phase 0.5 P1 — Native MediaBlock 補齐 promotes the bus to
 * a cross-runtime harness primitive: Native + Codex + future ClaudeCode
 * MCP marker path all share one side-channel).
 *
 * This file is a re-export shim. New code SHOULD import from the new
 * location. Existing call sites
 * (`src/lib/codex/proxy/builtin-bridge.ts`,
 * `src/lib/codex/runtime.ts`, the three event-bus tests) can keep
 * their imports until a follow-up sweep, but new imports of this path
 * are forbidden by source-grep pin in
 * `agent-loop-media-side-channel.test.ts`.
 */

export {
  subscribeBuiltinEvents,
  emitBuiltinEvent,
  __resetBuiltinEventBusForTests,
  __subscriberCountForTests,
} from '@/lib/harness/builtin-event-bus';
