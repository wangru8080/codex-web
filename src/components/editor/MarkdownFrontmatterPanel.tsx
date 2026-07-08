"use client";

/**
 * Frontmatter metadata strip for Markdown previews — Phase 4.
 *
 * Renders the YAML frontmatter key/value pairs as a compact dl above
 * the body. Hidden when the file has no frontmatter.
 *
 * The display is read-only on purpose — the source markdown remains
 * authoritative. Edits go through the existing MarkdownEditor save
 * path, which writes the verbatim text. We never round-trip data
 * through this panel back into the file.
 */

import {
  formatFrontmatterValue,
  type ParsedFrontmatter,
} from "@/lib/markdown/frontmatter";

interface MarkdownFrontmatterPanelProps {
  data: ParsedFrontmatter["data"];
}

export function MarkdownFrontmatterPanel({ data }: MarkdownFrontmatterPanelProps) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 border-b border-border/40 bg-muted/30 px-4 py-3 text-[11px]">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="font-semibold text-muted-foreground">{key}</dt>
          <dd className="truncate text-foreground/90">
            {formatFrontmatterValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
