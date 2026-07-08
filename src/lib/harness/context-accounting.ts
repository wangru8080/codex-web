/**
 * Phase 1 — Context Accounting Runtime Contract helpers.
 *
 * Type definitions live in `src/types/index.ts` (next to TokenUsage).
 * This module exposes:
 *   - re-exports of the contract types for convenient imports
 *   - stable ordering constants for renderers / tests
 *   - small factories (`makeEmptySnapshot`, `makeUnsupportedSnapshot`)
 *
 * See `docs/exec-plans/active/context-accounting-runtime-contract.md`.
 */

import type {
  ContextAccountingEntry,
  ContextAccountingKind,
  ContextAccountingRuntimeId,
  RuntimeContextAccountingSnapshot,
} from '@/types';

export type {
  ContextAccountingEntry,
  ContextAccountingKind,
  ContextAccountingRuntimeId,
  RuntimeContextAccountingSnapshot,
};

/** Stable rendering order for the popover. */
export const CONTEXT_ACCOUNTING_KIND_ORDER: readonly ContextAccountingKind[] = [
  'system_prompt',
  'tools',
  'rules',
  'skills',
  'mcp',
  'memory',
  'files_attachments',
] as const;

/**
 * Factory for an empty snapshot — Runtime says "I support all these
 * kinds in principle but this turn produced zero entries". UI still
 * hides empty rows.
 */
export function makeEmptySnapshot(
  producedBy: ContextAccountingRuntimeId,
  options?: { providerBackend?: string },
): RuntimeContextAccountingSnapshot {
  return {
    entries: {},
    unsupported: [],
    producedBy,
    ...(options?.providerBackend ? { providerBackend: options.providerBackend } : {}),
  };
}

/**
 * Factory for "all kinds unsupported" — useful when a Runtime hasn't
 * implemented its produce() yet. UI hides every row.
 */
export function makeAllUnsupportedSnapshot(
  producedBy: ContextAccountingRuntimeId,
  options?: { providerBackend?: string },
): RuntimeContextAccountingSnapshot {
  return {
    entries: {},
    unsupported: [...CONTEXT_ACCOUNTING_KIND_ORDER],
    producedBy,
    ...(options?.providerBackend ? { providerBackend: options.providerBackend } : {}),
  };
}

/**
 * Map a snapshot's `entries` to the `ContextBreakdownInputs.compiler`
 * shape consumed by `buildContextUsageBreakdown`. Kinds in
 * `unsupported` produce undefined (which the breakdown function reads
 * as "no data"); empty entries also produce undefined.
 *
 * IMPORTANT: this is the only path from a Runtime-produced snapshot to
 * the popover. Source breadcrumbs are intentionally NOT propagated
 * here — they're for debugging / future diagnostics. The hook layer
 * deliberately treats the snapshot as the authoritative end state;
 * caller filtering by source belongs upstream (in the Runtime
 * adapter), not in the rendering layer.
 */
export function snapshotToCompilerInputs(
  snapshot: RuntimeContextAccountingSnapshot | null | undefined,
): {
  systemPromptTokens?: number;
  toolDescriptorTokens?: number;
  workspaceRuleTokens?: number;
  skillsHarnessTokens?: number;
  mcpDescriptorTokens?: number;
  memoryTokens?: number;
} | undefined {
  if (!snapshot) return undefined;
  const get = (k: ContextAccountingKind): number | undefined => {
    if (snapshot.unsupported.includes(k)) return undefined;
    return snapshot.entries[k]?.tokens;
  };
  const result = {
    systemPromptTokens: get('system_prompt'),
    toolDescriptorTokens: get('tools'),
    workspaceRuleTokens: get('rules'),
    skillsHarnessTokens: get('skills'),
    mcpDescriptorTokens: get('mcp'),
    memoryTokens: get('memory'),
  };
  // If all kinds are undefined, return undefined so the breakdown
  // function knows nothing to merge.
  if (Object.values(result).every((v) => v === undefined)) return undefined;
  return result;
}
