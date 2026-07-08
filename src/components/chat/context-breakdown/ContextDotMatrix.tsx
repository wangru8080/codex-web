'use client';

/**
 * Phase 6 Phase 2b — dot-matrix main bar for the chat Context popover.
 *
 * Renders 100 cells (2 rows × 50) representing the breakdown by category.
 * Each cell is one of:
 *   - colored fill: a category's allocated share of the context window
 *     (background-color comes from --context-dot-{kebab-kind} in globals.css)
 *   - dashed outline + transparent fill: pending share (files_attachments /
 *     pending_next_turn) — "what would join the next turn"
 *   - muted empty fill: remaining capacity (only when contextWindow known)
 *
 * Cell allocation rules:
 *   - Denominator: contextWindow when known; otherwise usedTokens + pendingTotal
 *   - Each non-zero part rounds to ceil(tokens / denominator * cellCount), so
 *     a kind with a tiny non-zero share still shows at least one cell
 *   - Cells render in CONTEXT_BREAKDOWN_KIND_ORDER so the color stripe is
 *     stable across renders
 *   - Pending cells render after the used cells (visually distinct via
 *     dashed border) but before the empty cells
 *
 * Sub-component of ContextUsageIndicator / RunCockpitPopoverContent — not a
 * standalone mount surface.
 */

import type {
  ContextBreakdownKind,
  ContextUsageBreakdown,
} from '@/lib/context-breakdown';
import {
  CONTEXT_BREAKDOWN_KIND_ORDER,
  PENDING_BREAKDOWN_KINDS,
} from '@/lib/context-breakdown';
import { cn } from '@/lib/utils';

const PENDING_SET = new Set<ContextBreakdownKind>(PENDING_BREAKDOWN_KINDS);

function dotVar(kind: ContextBreakdownKind): string {
  return `var(--context-dot-${kind.replace(/_/g, '-')})`;
}

interface CellAllocation {
  kind: ContextBreakdownKind;
  cells: number;
  isPending: boolean;
}

/** Exported for unit tests; not part of the public render API. */
export function computeAllocations(
  breakdown: ContextUsageBreakdown,
  cellCount: number,
  minCellsPerKind: 0 | 1,
): { cells: CellAllocation[]; emptyCells: number } {
  const partsByKind = new Map(
    breakdown.parts.map((p) => [p.kind, p] as const),
  );

  // Denominator decides what one cell represents.
  // When contextWindow is known: 1 cell = contextWindow / cellCount tokens.
  // When UNKNOWN: both modes distribute by used + pending — a composition
  // view (relative kind sizes), NOT a capacity %.
  //
  // v0.56.x #632 follow-up: the old mini-bar (minCellsPerKind=0) fell back to
  // a typical-window constant (~200k) so it could draw a "believable rough %".
  // But that fabricated a capacity the upstream never reported — the trigger
  // still implied "used / remaining" against a guess. Removed. RunCockpit now
  // HIDES the mini-bar entirely when the window is untrusted (showing only the
  // absolute used-token text), so in practice this unknown branch only serves
  // the popover's composition view — no fabricated denominator anywhere.
  const pendingTotal = breakdown.parts
    .filter((p) => PENDING_SET.has(p.kind))
    .reduce((s, p) => s + p.tokens, 0);
  const windowKnown =
    typeof breakdown.contextWindow === 'number' && breakdown.contextWindow > 0;
  const denominator = windowKnown
    ? (breakdown.contextWindow as number)
    : breakdown.usedTokens + pendingTotal;

  if (denominator <= 0) return { cells: [], emptyCells: cellCount };

  const allocations: CellAllocation[] = [];
  let totalAllocated = 0;

  // Allocation strategy depends on minCellsPerKind:
  //   1 — popover (default): every non-zero category surfaces at least 1
  //       cell, even when its share rounds to 0. Use Math.max(1, ceil)
  //       so 100-cell main bar shows every visible category.
  //   0 — mini-bar (10-cell trigger): no minimum. Tiny categories that
  //       round below 0.5 disappear; otherwise round to nearest.
  //       Without this, 5 categories each holding 2% of context would
  //       force 5 cells = 50% mini-bar fill at ~10% real usage.
  const allocate = (raw: number): number =>
    minCellsPerKind === 1 ? Math.max(1, Math.ceil(raw)) : Math.round(raw);

  // First pass: used kinds in stable order.
  for (const kind of CONTEXT_BREAKDOWN_KIND_ORDER) {
    if (PENDING_SET.has(kind)) continue;
    const part = partsByKind.get(kind);
    if (!part || part.tokens <= 0) continue;
    const raw = (part.tokens / denominator) * cellCount;
    const cells = allocate(raw);
    if (cells <= 0) continue;
    allocations.push({ kind, cells, isPending: false });
    totalAllocated += cells;
  }

  // Second pass: pending kinds.
  for (const kind of CONTEXT_BREAKDOWN_KIND_ORDER) {
    if (!PENDING_SET.has(kind)) continue;
    const part = partsByKind.get(kind);
    if (!part || part.tokens <= 0) continue;
    const raw = (part.tokens / denominator) * cellCount;
    const cells = allocate(raw);
    if (cells <= 0) continue;
    allocations.push({ kind, cells, isPending: true });
    totalAllocated += cells;
  }

  // Cap at cellCount in case rounding overshoots; trim from the end.
  if (totalAllocated > cellCount) {
    let overshoot = totalAllocated - cellCount;
    for (let i = allocations.length - 1; i >= 0 && overshoot > 0; i--) {
      const take = Math.min(overshoot, allocations[i].cells);
      allocations[i].cells -= take;
      overshoot -= take;
    }
    // Drop any zero-cell entries left behind.
    return {
      cells: allocations.filter((a) => a.cells > 0),
      emptyCells: 0,
    };
  }

  // Mini-bar usage indicator: when `minCellsPerKind=0` (round-without-min)
  // and total used > 0 but everything rounds below 0.5, the mini-bar ends
  // up completely empty even though the user IS using context. Boost the
  // largest category to 1 cell so "some usage exists" is visible.
  // Example: Codex at 1% real usage on 10-cell mini-bar → round → 0 cells
  // → confusing "I just sent a message but bar is empty". With this boost,
  // the largest non-zero category becomes 1 cell — small but visible.
  if (
    minCellsPerKind === 0
    && totalAllocated === 0
    && breakdown.usedTokens > 0
  ) {
    // Find the largest non-pending used category to host the 1-cell marker.
    let largestKind: ContextBreakdownKind | null = null;
    let largestTokens = 0;
    for (const part of breakdown.parts) {
      if (PENDING_SET.has(part.kind)) continue;
      if (part.tokens > largestTokens) {
        largestTokens = part.tokens;
        largestKind = part.kind;
      }
    }
    if (largestKind) {
      allocations.push({ kind: largestKind, cells: 1, isPending: false });
      totalAllocated = 1;
    }
  }

  return { cells: allocations, emptyCells: cellCount - totalAllocated };
}

export interface ContextDotMatrixProps {
  breakdown: ContextUsageBreakdown;
  /** Total number of cells. Default 100 (2 rows × 50 columns). */
  cellCount?: number;
  /**
   * Row count. Default 2 → 100 cells lays out as 50 columns × 2 rows.
   * Phase 6 (2026-05-19): cells flow column-major — the first column
   * gets [row1, row2], then column 2 gets [row1, row2], etc. That way
   * "used" cells light up column-by-column from left to right instead
   * of filling all of row 1 before any of row 2.
   */
  rows?: number;
  /**
   * Minimum cells per non-zero category.
   *   - 1 (default, popover): every visible category gets at least 1 cell
   *     so the breakdown legend matches the bar one-to-one.
   *   - 0 (mini-bar / trigger): no minimum — tiny categories that round
   *     below 0.5 disappear. Required for 10-cell trigger so 5 tiny
   *     categories don't each force 1 cell and overshoot real usage.
   *
   * Caller should pass 0 when cellCount is small (e.g. 10) and the bar
   * is used as a rough fullness signal rather than a full legend.
   */
  minCellsPerKind?: 0 | 1;
  className?: string;
}

export function ContextDotMatrix({
  breakdown,
  cellCount = 100,
  rows = 2,
  minCellsPerKind = 1,
  className,
}: ContextDotMatrixProps) {
  const { cells: allocations, emptyCells } = computeAllocations(
    breakdown,
    cellCount,
    minCellsPerKind,
  );

  if (allocations.length === 0 && emptyCells === 0) return null;

  return (
    <div
      aria-hidden
      className={cn('grid gap-px', className)}
      style={{
        // Column-major flow: rows are fixed, columns flow as needed.
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        gridAutoFlow: 'column',
        gridAutoColumns: 'minmax(0, 1fr)',
      }}
    >
      {allocations.flatMap((alloc) =>
        Array.from({ length: alloc.cells }, (_, i) => (
          <span
            key={`${alloc.kind}-${i}`}
            className={cn(
              'aspect-square rounded-[2px]',
              alloc.isPending &&
                'border border-dashed border-muted-foreground bg-transparent',
            )}
            style={
              alloc.isPending
                ? undefined
                : { backgroundColor: dotVar(alloc.kind) }
            }
          />
        )),
      )}
      {Array.from({ length: emptyCells }, (_, i) => (
        <span
          key={`empty-${i}`}
          className="aspect-square rounded-[2px] bg-muted/60"
        />
      ))}
    </div>
  );
}
