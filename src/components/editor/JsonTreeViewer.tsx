"use client";

/**
 * Lightweight JSON tree viewer — Phase 4.B Artifact richer preview.
 *
 * Used by PreviewPanel when the active PreviewSource is `inline-json`
 * (typically a ```json fenced code block clicked from chat). The
 * viewer parses the text once; on parse failure it falls back to a
 * pre-formatted block so the user can still see what they sent.
 *
 * No external dependency — this is a small recursive component that
 * gives users a foldable, navigable structure without dragging in a
 * full JSON-viewer library. Default expansion depth is 2 levels which
 * covers most chat-pasted JSON payloads without a giant initial
 * scroll. Deeper levels collapse and surface a tap-to-expand chip.
 */

import { useState, useMemo } from "react";
import { CaretDown, CaretRight } from "@/components/ui/icon";

interface JsonTreeViewerProps {
  text: string;
  /** Initial expansion depth — children deeper than this start
   *  collapsed. Defaults to 2 (top-level + first nested layer). */
  defaultDepth?: number;
}

export function JsonTreeViewer({ text, defaultDepth = 2 }: JsonTreeViewerProps) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [text]);

  if (!parsed.ok) {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        <p className="text-[11px] text-destructive">
          Invalid JSON: {parsed.error}
        </p>
        <pre className="overflow-auto rounded bg-muted/40 p-3 text-[11px] font-mono leading-relaxed">
          {text}
        </pre>
      </div>
    );
  }

  return (
    <div className="overflow-auto p-3 text-[11px] font-mono leading-relaxed">
      <JsonNode value={parsed.value} depth={0} defaultDepth={defaultDepth} />
    </div>
  );
}

function JsonNode({
  name,
  value,
  depth,
  defaultDepth,
}: {
  name?: string;
  value: unknown;
  depth: number;
  defaultDepth: number;
}) {
  const expandable = isExpandable(value);
  const [expanded, setExpanded] = useState(depth < defaultDepth);

  if (!expandable) {
    return (
      <div className="flex items-baseline gap-1.5">
        {name !== undefined && (
          <span className="text-purple-500 dark:text-purple-400">{`"${name}":`}</span>
        )}
        <ScalarValue value={value} />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const summary = isArray ? `Array(${entries.length})` : `Object(${entries.length})`;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-baseline gap-1 hover:text-foreground"
      >
        {expanded ? (
          <CaretDown size={11} className="shrink-0" />
        ) : (
          <CaretRight size={11} className="shrink-0" />
        )}
        {name !== undefined && (
          <span className="text-purple-500 dark:text-purple-400">{`"${name}":`}</span>
        )}
        <span className="text-muted-foreground">
          {isArray ? "[" : "{"} {!expanded && summary}
          {!expanded && (isArray ? "]" : "}")}
        </span>
      </button>
      {expanded && (
        <div className="ml-3 border-l border-muted/40 pl-2">
          {entries.map(([k, v]) => (
            <JsonNode
              key={k}
              name={isArray ? undefined : k}
              value={v}
              depth={depth + 1}
              defaultDepth={defaultDepth}
            />
          ))}
          <div className="text-muted-foreground">{isArray ? "]" : "}"}</div>
        </div>
      )}
    </div>
  );
}

function ScalarValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="text-muted-foreground italic">null</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className="text-amber-600 dark:text-amber-400">{String(value)}</span>
    );
  }
  if (typeof value === "number") {
    return <span className="text-blue-600 dark:text-blue-400">{value}</span>;
  }
  if (typeof value === "string") {
    return (
      <span className="text-emerald-600 dark:text-emerald-400">{`"${value}"`}</span>
    );
  }
  return <span>{String(value)}</span>;
}

function isExpandable(value: unknown): boolean {
  if (value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return false;
}
