"use client";

/**
 * Outline rail for Markdown previews — Phase 4 Markdown data layer.
 *
 * Renders a sticky table-of-contents next to the rendered Markdown.
 * Clicking an entry finds the matching heading element by slug and
 * scrolls it into view. The slugger here (`parseOutline`'s output)
 * must match what `injectHeadingIds` writes into the rendered DOM —
 * both come from the same `slugify()` helper to keep them aligned.
 */

import { useCallback } from "react";
import type { OutlineHeading } from "@/lib/markdown/outline";

export interface MarkdownOutlineRailProps {
  headings: OutlineHeading[];
  /** Container element whose descendants contain the rendered headings.
   *  Click-to-scroll uses `container.querySelector('#<slug>')`; passing
   *  the panel's content scroller (not document) keeps each PreviewPanel
   *  instance scoped to its own headings if there's ever more than one. */
  containerRef: React.RefObject<HTMLElement | null>;
}

export function MarkdownOutlineRail({
  headings,
  containerRef,
}: MarkdownOutlineRailProps) {
  const onJump = useCallback(
    (slug: string) => {
      const root = containerRef.current ?? document;
      const target = root.querySelector<HTMLElement>(`#${cssEscape(slug)}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [containerRef],
  );

  if (headings.length === 0) return null;

  return (
    <nav
      aria-label="Markdown outline"
      className="border-l border-border/40 bg-muted/20 px-3 py-3 text-[11px] leading-relaxed"
    >
      <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
        Outline
      </p>
      <ul className="space-y-0.5">
        {headings.map((h) => (
          <li
            key={`${h.slug}-${h.line}`}
            style={{ paddingLeft: `${(h.level - 1) * 8}px` }}
          >
            <button
              type="button"
              onClick={() => onJump(h.slug)}
              className="text-left text-muted-foreground hover:text-foreground transition-colors"
              title={`Jump to "${h.text}"`}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Walk the rendered Markdown DOM and stamp `id` attributes on every
 * heading whose text slug appears in the outline. This is what makes
 * `containerRef.querySelector('#<slug>')` succeed even though
 * streamdown doesn't produce IDs natively.
 *
 * Idempotent — if a heading already has the right id, we leave it.
 */
export function injectHeadingIds(
  containerRef: React.RefObject<HTMLElement | null>,
  headings: OutlineHeading[],
): void {
  const root = containerRef.current;
  if (!root) return;
  const headingNodes = root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
  // Maintain a parallel cursor through the outline so duplicate text
  // (with `-2`, `-3` suffixes) lands on the right node. Headings inside
  // the outline parser are in document order; the DOM nodes are too,
  // so a sequential pairing is enough.
  let cursor = 0;
  headingNodes.forEach((node) => {
    const text = (node.textContent ?? "").trim();
    while (cursor < headings.length && headings[cursor].text !== text) {
      cursor++;
    }
    if (cursor < headings.length) {
      node.id = headings[cursor].slug;
      cursor++;
    }
  });
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^\w-]/g, (c) => `\\${c}`);
}

/**
 * Post-render pass for Obsidian-style callouts. The callout rewriter
 * (src/lib/markdown/callout.ts) injects an `⟦codepilot-callout:<type>⟧`
 * sentinel into the first paragraph of each callout blockquote. This
 * helper walks the rendered DOM, finds those sentinels, stamps the
 * matching `codepilot-callout-<type>` class on the parent blockquote
 * + a `data-callout` attribute, and erases the sentinel text so the
 * reader never sees it.
 *
 * Idempotent — re-runs find the same nodes but skip ones that
 * already have a `data-callout` attribute, so multiple render passes
 * don't double-process the tree.
 */
export function applyCalloutClasses(
  containerRef: React.RefObject<HTMLElement | null>,
): void {
  const root = containerRef.current;
  if (!root) return;
  const blockquotes = root.querySelectorAll<HTMLElement>("blockquote");
  blockquotes.forEach((bq) => {
    if (bq.hasAttribute("data-callout")) return;
    const text = bq.textContent || "";
    const m = text.match(/⟦codepilot-callout:([a-z]+)⟧/);
    if (!m) return;
    const type = m[1];
    bq.setAttribute("data-callout", type);
    bq.classList.add("codepilot-callout", `codepilot-callout-${type}`);
    // Erase the marker by walking text nodes — preserve the rest of
    // the paragraph + any inline styling streamdown applied.
    const walker = document.createTreeWalker(bq, NodeFilter.SHOW_TEXT, null);
    const targets: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      if ((node.nodeValue || "").includes("⟦codepilot-callout:")) {
        targets.push(node as Text);
      }
      node = walker.nextNode();
    }
    for (const t of targets) {
      const stripped = (t.nodeValue || "").replace(/⟦codepilot-callout:[a-z]+⟧\s*/g, "");
      if (!stripped) {
        // Drop the empty paragraph wrapper too if it became empty.
        const parent = t.parentElement;
        t.remove();
        if (parent && !parent.textContent?.trim() && parent.tagName === "P") {
          parent.remove();
        }
      } else {
        t.nodeValue = stripped;
      }
    }
  });
}
