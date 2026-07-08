"use client";

/**
 * Unified-diff viewer — Phase 4.B Artifact richer preview.
 *
 * Used by PreviewPanel when the active PreviewSource is `inline-diff`,
 * typically from a ```diff fenced code block. Highlights +/- lines and
 * hunk headers; passes everything else through verbatim.
 *
 * Deliberately simple: no syntactic parsing of the surrounding file
 * format, no expand/collapse of hunks, no inline word diff. The goal
 * is "I can read this diff comfortably without manual visual triage,"
 * not a full diff IDE. A power-user diff editor lives outside this
 * surface — this is for the chat-side glance-then-act case.
 */

import { useMemo } from "react";

interface DiffViewerProps {
  diff: string;
}

interface ClassifiedLine {
  kind: "header" | "added" | "removed" | "context" | "meta";
  text: string;
}

export function DiffViewer({ diff }: DiffViewerProps) {
  const lines = useMemo<ClassifiedLine[]>(() => classifyDiff(diff), [diff]);
  return (
    <div className="overflow-auto p-3 font-mono text-[11px] leading-relaxed">
      <div className="min-w-max">
        {lines.map((line, idx) => (
          <div
            key={idx}
            className={
              line.kind === "added"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : line.kind === "removed"
                  ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                  : line.kind === "header"
                    ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 font-semibold"
                    : line.kind === "meta"
                      ? "text-muted-foreground"
                      : "text-foreground/80"
            }
          >
            {line.text || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Classify each line of a unified-diff string. Recognized prefixes:
 *
 *   diff / --- / +++ / index → meta (the file-level header rows)
 *   @@ … @@                   → header (hunk markers)
 *   +                         → added (excluding the +++ file header)
 *   -                         → removed (excluding the --- file header)
 *   anything else             → context
 *
 * Exported so unit tests can pin the classification table without
 * mounting React.
 */
export function classifyDiff(diff: string): ClassifiedLine[] {
  const out: ClassifiedLine[] = [];
  for (const raw of diff.split(/\r?\n/)) {
    out.push({ kind: classifyLine(raw), text: raw });
  }
  return out;
}

function classifyLine(line: string): ClassifiedLine["kind"] {
  if (line.startsWith("@@")) return "header";
  if (
    line.startsWith("diff ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("index ") ||
    line.startsWith("new file mode") ||
    line.startsWith("deleted file mode") ||
    line.startsWith("similarity index") ||
    line.startsWith("rename ")
  ) {
    return "meta";
  }
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}
