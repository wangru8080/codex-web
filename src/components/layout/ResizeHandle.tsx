"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  side: "left" | "right";
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  /** Optional double-click handler — typical use is "reset to default width". */
  onReset?: () => void;
}

/**
 * Resize handle between two adjacent flex cards.
 *
 * Round 33 — reworked based on Craft Agent's `PanelResizeSash` pattern:
 *   • Hit area is ~8px wide (twice as easy to grab as the old 4px).
 *   • Visible line is only 2px and lives centered inside the hit area
 *     via `inset-x` negative offsets — so the line never visually
 *     widens the gutter, just the hit area underneath does.
 *   • Hover paints a cursor-following gradient highlight, replacing
 *     the previous "always invisible until drag" model that left
 *     users guessing where to grab.
 *   • Optional `onReset` handler runs on double-click so users can
 *     snap back to default width without trial-and-error.
 */
export function ResizeHandle({ side, onResize, onResizeEnd, onReset }: ResizeHandleProps) {
  const isDragging = useRef(false);
  const startX = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverY, setHoverY] = useState<number | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startX.current = e.clientX;
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Track Y for hover gradient indicator regardless of drag state.
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setHoverY(e.clientY - rect.top);
      }
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      startX.current = e.clientX;
      onResize(delta);
    },
    [onResize]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      setDragging(false);
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onResizeEnd?.();
    },
    [onResizeEnd]
  );

  const handlePointerLeave = useCallback(() => {
    if (!isDragging.current) setHoverY(null);
  }, []);

  // Cursor-following gradient (mirrors Craft Agent's `useResizeGradient`)
  // — the line is most intense where the cursor hovers and fades to
  // transparent toward the top and bottom of the handle.
  const gradientBg = (() => {
    if (!dragging && hoverY === null) return undefined;
    if (containerRef.current) {
      const h = containerRef.current.getBoundingClientRect().height;
      const cy = dragging ? h / 2 : (hoverY ?? h / 2);
      // Edge buffer keeps the brightest stop from kissing the rounded
      // card corners above/below — matches Craft's 64px clamp.
      const edge = Math.min(64, h / 2);
      const center = Math.max(edge, Math.min(h - edge, cy));
      const near = Math.max(20, edge * 0.22);
      const far = Math.max(56, edge * 0.75);
      const alphaPeak = dragging ? 0.36 : 0.24;
      const alphaMid = dragging ? 0.18 : 0.12;
      const alphaEdge = dragging ? 0.10 : 0.06;
      return {
        background: `linear-gradient(
          to bottom,
          transparent 0px,
          color-mix(in oklch, var(--foreground) ${Math.round(alphaEdge * 100)}%, transparent) ${center - far}px,
          color-mix(in oklch, var(--foreground) ${Math.round(alphaMid * 100)}%, transparent) ${center - near}px,
          color-mix(in oklch, var(--foreground) ${Math.round(alphaPeak * 100)}%, transparent) ${center}px,
          color-mix(in oklch, var(--foreground) ${Math.round(alphaMid * 100)}%, transparent) ${center + near}px,
          color-mix(in oklch, var(--foreground) ${Math.round(alphaEdge * 100)}%, transparent) ${center + far}px,
          transparent ${h}px
        )`,
      };
    }
    return undefined;
  })();

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={onReset}
      className={cn(
        // 8px hit area, 0-width in layout via negative margin so the
        // gutter doesn't widen visually. -ml-1 / -mr-1 pull the handle
        // halfway into each neighbor's edge.
        "relative z-10 flex h-full w-2 shrink-0 cursor-col-resize items-stretch justify-center touch-none",
        side === "left" ? "-ml-1" : "-mr-1"
      )}
    >
      {/* Visible 2px line, centered, gradient-painted via inline style.
          Transition keeps the appear/disappear smooth on hover-out. */}
      <div
        className="pointer-events-none w-0.5 transition-opacity duration-150"
        style={{
          opacity: dragging || hoverY !== null ? 1 : 0,
          ...gradientBg,
        }}
      />
    </div>
  );
}
