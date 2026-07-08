/**
 * Expected Differences Ledger — Phase 5d Phase 2 (2026-05-17).
 *
 * The equivalence harness in
 * `harness-context-compiler-equivalence.test.ts` compares what the
 * compiler emits against what each Runtime's current implementation
 * actually injects (by reading the canonical source files). Many
 * pre-existing differences are KNOWN drift documented in slice-7b
 * tech-debt — those are not regressions, they're the canonicalisation
 * targets later Phase 2 slices intend to consume.
 *
 * This ledger is the explicit allow-list:
 *
 *   - 2b harness: compiler-vs-runtime fragment diff MUST be a subset
 *     of the ledger; un-listed differences trip the test.
 *   - 2c–2e migration: when a runtime adopts the compiler, the
 *     corresponding ledger entry is **manually** removed by the
 *     migrating slice (deliberate non-automation: keeps an audit
 *     trail of what each slice actually consumed).
 *   - Phase 5d Phase 5 (new-Runtime Playbook): a new runtime's
 *     initial ledger SHOULD have only `follow_up` entries with
 *     documented next steps, never `slice_2*` entries.
 *
 * If the ledger ever points at a capability or file that no longer
 * exists, the consistency test (`harness-context-compiler.test.ts`
 * `Expected Differences Ledger — internal consistency`) fails. Update
 * the ledger first, then remove the source.
 */

import type { RuntimeId } from '@/lib/runtime/runtime-id';

export type ExpectedDifferenceKind =
  /** The runtime currently uses a paraphrased capability prompt; the
   *  compiler emits the canonical one. After migration to compiler
   *  the runtime stops using the paraphrase. */
  | 'capability_fragment_replaced'
  /** The runtime currently has NO fragment for this capability; the
   *  compiler emits one. Migration adds it. */
  | 'capability_fragment_added'
  /** The runtime currently emits an extra fragment the compiler does
   *  not; migration drops the extra (it duplicates / drifts). */
  | 'capability_fragment_removed'
  /** Tool schema differs between runtime + compiler. Currently
   *  compiler doesn't own tool schemas (those stay in factories), so
   *  this kind is reserved for future use. */
  | 'tool_schema_canonicalized'
  /** Tool result shape differs (e.g. Native image_generation returns
   *  text only, compiler expects media). Not a prompt-level diff so
   *  the 2b harness only records it; resolution path lives outside
   *  the compiler (e.g. update the tool factory). */
  | 'tool_result_shape_canonicalized';

export type ExpectedDifferenceResolution =
  | 'slice_2c'  // ClaudeCode SDK Runtime adopts compiler
  | 'slice_2d'  // CodexWeb Native Runtime adopts compiler
  | 'slice_2e'  // Codex Runtime bridge adopts compiler
  | 'follow_up';

export interface ExpectedDifference {
  readonly runtimeId: RuntimeId;
  /** Capability id from `capability-contract.ts`. Consistency test
   *  verifies this resolves. */
  readonly capability: string;
  readonly diff: ExpectedDifferenceKind;
  /** Human-readable description of what differs. */
  readonly description: string;
  /** Why this difference is expected (not a regression). */
  readonly justification: string;
  readonly plannedResolution: ExpectedDifferenceResolution;
  /** What the compiler emits (the canonical side). Consistency test
   *  resolves these paths. */
  readonly compilerSource: {
    readonly sourceFile: string;
    readonly sourceExport: string;
  };
  /** What the runtime currently emits (the drift side). Optional
   *  because some diff kinds — e.g. `capability_fragment_added` —
   *  have no runtime-side source. */
  readonly runtimeSource?: {
    readonly sourceFile: string;
    readonly sourceExport: string;
  };
}

/**
 * Initial ledger after Phase 5d Phase 2 slice 2d (2026-05-17) — the
 * three Native paraphrase entries for memory / tasks_and_notify /
 * media_import have been consumed. Native source files now
 * re-export from the MCP canonical:
 *
 *   - `src/lib/builtin-tools/memory-search.ts` → re-exports
 *     `MEMORY_SEARCH_SYSTEM_PROMPT` from `memory-search-mcp.ts`
 *   - `src/lib/builtin-tools/notification.ts` → re-exports
 *     `NOTIFICATION_MCP_SYSTEM_PROMPT` (keeping the local name
 *     `NOTIFICATION_SYSTEM_PROMPT` for call-site stability)
 *   - `src/lib/builtin-tools/media.ts` → re-exports
 *     `MEDIA_MCP_SYSTEM_PROMPT` from `media-import-mcp.ts`
 *
 * Phase 5e Phase 0.5 P1 (2026-05-17 Native MediaBlock 補齐) — the
 * final `tool_result_shape_canonicalized` follow_up entry for
 * `image_generation` is now resolved. `builtin-tools/media.ts`
 * emits MediaBlock[] via the harness side-channel
 * (`@/lib/harness/builtin-event-bus`); `agent-loop.ts` splices the
 * blocks into the SSE `tool_result.media` field. Ledger is now
 * EMPTY — that is by design: any new entry here must come with a
 * documented `plannedResolution`, and adding entries silently
 * (without a slice owner) is forbidden by the consistency test in
 * `harness-context-compiler.test.ts`.
 *
 * New entries land here when (a) a runtime is mid-migration and the
 * compiler intentionally emits something the runtime current code
 * doesn't, or (b) a `follow_up` is opened for a non-prompt drift.
 */
export const EXPECTED_DIFFERENCES: readonly ExpectedDifference[] = [];

// ─────────────────────────────────────────────────────────────────────
// Accessors
// ─────────────────────────────────────────────────────────────────────

export function expectedDifferencesFor(
  runtimeId: RuntimeId,
): readonly ExpectedDifference[] {
  return EXPECTED_DIFFERENCES.filter((d) => d.runtimeId === runtimeId);
}

export function expectedDifferencesByCapability(
  capabilityId: string,
): readonly ExpectedDifference[] {
  return EXPECTED_DIFFERENCES.filter((d) => d.capability === capabilityId);
}
