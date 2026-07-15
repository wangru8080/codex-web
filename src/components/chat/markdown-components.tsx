"use client";

/**
 * Markdown element overrides for chat messages.
 *
 * Plugged into <Streamdown components={CHAT_MARKDOWN_COMPONENTS}/> from
 * `MessageResponse` in `src/components/ai-elements/message.tsx`. The
 * goal is to bring the AI reply rendering in line with the same design
 * language the Widget card uses (rounded-xl card, muted backdrop,
 * always-visible top-right action buttons) instead of streamdown's
 * default browser-paper look.
 *
 * Geometry / colors mirror Widget card:
 *   - container: `rounded-xl bg-muted/20 p-4 my-4`
 *   - action button: `h-7 px-2 gap-1 rounded-md text-xs hover:bg-muted`
 *   - actions sit absolute top-2 right-2 — permanent, no opacity-gate
 *
 * Typography overrides bump every heading + paragraph one notch from
 * streamdown defaults so the chat thread reads at our application
 * font scale, not the library's compact default.
 *
 * Round 12 (2026-05-23): first cut of the unified markdown rendering.
 * "Export as PNG" on tables is deferred — that needs the same
 * `electronAPI.widget.exportPng` pipeline the Widget uses and is a
 * separate slice; the action button slot is reserved so we can
 * plug it in without restyling.
 */

import type { ComponentProps, ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { showToast } from "@/hooks/useToast";
import { usePanel } from "@/hooks/usePanel";
import { classifyChatLinkHref } from "@/lib/markdown/chat-link";
import { classifyPath } from "@/lib/preview-source";
import { resolveToolPath } from "@/lib/file-write-tools";

// Shared card-action-button class — same geometry as Widget toolbar.
// `justify-center` is intentional: icon-only variants (h-7 w-7 px-0)
// would otherwise hug the left edge of the button, putting the
// hover background visibly off-center from the glyph. Round 13
// fix after user feedback.
const cardActionBtn =
  "h-7 px-2 gap-1 inline-flex items-center justify-center rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none";

// Recursively flatten React children to plain text. Used for "copy as
// plaintext" fallbacks where we don't need full markdown round-trip.
function childrenToText(children: ReactNode): string {
  if (children == null || children === false) return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join("");
  if (typeof children === "object" && children !== null && "props" in children) {
    // ReactElement
    const props = (children as { props?: { children?: ReactNode } }).props;
    return childrenToText(props?.children);
  }
  return "";
}

// ---------------------------------------------------------------------------
// Table → Widget-style card with action buttons
// ---------------------------------------------------------------------------

function ChatTable({ children, className, ...props }: ComponentProps<"table">) {
  const tableRef = useRef<HTMLTableElement>(null);

  // Copy the table's current visual content as a Markdown pipe table.
  // We walk the live DOM (rather than the React tree) because by the
  // time the click handler fires the streamdown blocks have already
  // committed; the DOM is the source of truth and avoids re-deriving
  // the markdown string from JSX.
  const handleCopyMarkdown = useCallback(async () => {
    const table = tableRef.current;
    if (!table) return;
    const rows: string[][] = [];
    table.querySelectorAll("tr").forEach((tr) => {
      const cells: string[] = [];
      tr.querySelectorAll("th, td").forEach((cell) => {
        // Cell text — collapse newlines so the pipe table stays one
        // row per source row. Escape pipes inside cells.
        cells.push((cell.textContent ?? "").replace(/\n+/g, " ").replace(/\|/g, "\\|").trim());
      });
      if (cells.length > 0) rows.push(cells);
    });
    if (rows.length === 0) return;
    const cols = rows[0].length;
    const lines: string[] = [];
    lines.push(`| ${rows[0].join(" | ")} |`);
    lines.push(`| ${Array.from({ length: cols }, () => "---").join(" | ")} |`);
    for (let i = 1; i < rows.length; i++) {
      lines.push(`| ${rows[i].join(" | ")} |`);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showToast({ type: "success", message: "已复制 Markdown 表格" });
    } catch {
      showToast({ type: "error", message: "复制失败" });
    }
  }, []);

  // Round 14: table body is inset from the card edges (px-3 pb-3 on
  // the scroll wrapper) so the horizontal dividers no longer run
  // from card-left to card-right. The action header bar stays full
  // width, which keeps the visual top of the card clean.
  return (
    <div className="my-4 rounded-xl bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-end gap-1 bg-muted/30 px-2 py-1">
        <button type="button" onClick={handleCopyMarkdown} className={cn(cardActionBtn, "h-7 w-7 px-0")} aria-label="Copy as Markdown" title="复制 Markdown">
          <CodexWebIcon name="copy" size="sm" aria-hidden />
        </button>
        {/* Export PNG placeholder — same slot the Widget card uses for
            its download button. Wire-up deferred; needs the
            electronAPI.widget.exportPng plumbing applied to an HTML
            snapshot of the table. */}
        <button type="button" disabled className={cn(cardActionBtn, "h-7 w-7 px-0")} aria-label="Export PNG (coming soon)" title="导出图片（即将上线）">
          <CodexWebIcon name="download" size="sm" aria-hidden />
        </button>
      </div>
      <div className="overflow-x-auto px-3 pb-3 pt-2">
        <table ref={tableRef} className={cn("w-full text-sm border-collapse", className)} {...props}>
          {children}
        </table>
      </div>
    </div>
  );
}

function ChatTHead(props: ComponentProps<"thead">) {
  return <thead className="border-b border-border/60 bg-muted/40 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium" {...props} />;
}
function ChatTBody(props: ComponentProps<"tbody">) {
  return <tbody className="[&_tr]:border-b [&_tr]:border-border/30 [&_tr:last-child]:border-0 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top" {...props} />;
}

// ---------------------------------------------------------------------------
// Code block — Widget-style card with copy button
// ---------------------------------------------------------------------------
// streamdown's `code` plugin highlights via Shiki and ships its own
// `<pre>`. We only override `pre` so the OUTER chrome matches the
// Widget card; the inner highlighted code is left to the plugin.

function ChatPre({ children, className, ...props }: ComponentProps<"pre">) {
  const preRef = useRef<HTMLPreElement>(null);

  // Inspect the code child for a language hint — streamdown puts the
  // language as `data-language` on the code element when its shiki
  // plugin runs. Fall back to "code" so the badge always shows.
  const langGuess = (() => {
    if (!Array.isArray(children) && typeof children === "object" && children && "props" in children) {
      const props = (children as { props?: Record<string, unknown> }).props;
      const dl = props?.["data-language"];
      if (typeof dl === "string") return dl;
      const cls = props?.className;
      if (typeof cls === "string") {
        const m = cls.match(/language-([a-z0-9+#-]+)/i);
        if (m) return m[1];
      }
    }
    return "";
  })();

  const handleCopy = useCallback(async () => {
    const pre = preRef.current;
    if (!pre) return;
    const txt = pre.innerText;
    try {
      await navigator.clipboard.writeText(txt);
      showToast({ type: "success", message: "已复制" });
    } catch {
      showToast({ type: "error", message: "复制失败" });
    }
  }, []);

  // Same header-bar layout as ChatTable — keeps the action buttons
  // out of the code area so long single-line code can use the full
  // card width without hiding behind the copy button.
  // Round 14: header bar uses `bg-muted/30` to mark itself off from
  // the code area; the explicit `border-b` between header and pre
  // was redundant (color shift already does the separation) and
  // showed as an extra hairline that didn't read well.
  return (
    <div className="my-4 rounded-xl bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-between gap-2 bg-muted/30 px-3 py-1">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
          {langGuess || "code"}
        </span>
        <button type="button" onClick={handleCopy} className={cn(cardActionBtn, "h-7 w-7 px-0")} aria-label="Copy code" title="复制代码">
          <CodexWebIcon name="copy" size="sm" aria-hidden />
        </button>
      </div>
      <pre
        ref={preRef}
        className={cn("overflow-x-auto px-4 py-3 text-sm font-mono leading-relaxed", className)}
        {...props}
      >
        {children}
      </pre>
    </div>
  );
}

// Inline code (single backtick). Don't apply card chrome — just a
// muted pill so it stands out in prose.
function ChatInlineCode({ className, ...props }: ComponentProps<"code">) {
  return (
    <code
      className={cn(
        "rounded bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-foreground",
        className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Typography — heading / paragraph / list / blockquote / hr / link
// ---------------------------------------------------------------------------

function ChatH1(props: ComponentProps<"h1">) {
  return <h1 className="mt-6 mb-3 text-2xl font-semibold tracking-tight" {...props} />;
}
function ChatH2(props: ComponentProps<"h2">) {
  return <h2 className="mt-5 mb-3 text-xl font-semibold tracking-tight" {...props} />;
}
function ChatH3(props: ComponentProps<"h3">) {
  return <h3 className="mt-4 mb-2 text-lg font-semibold" {...props} />;
}
function ChatH4(props: ComponentProps<"h4">) {
  return <h4 className="mt-3 mb-2 text-base font-semibold" {...props} />;
}
function ChatParagraph(props: ComponentProps<"p">) {
  return <p className="my-3 leading-7" {...props} />;
}
function ChatUl(props: ComponentProps<"ul">) {
  return <ul className="my-3 ml-5 list-disc space-y-1.5 marker:text-muted-foreground/60" {...props} />;
}
function ChatOl(props: ComponentProps<"ol">) {
  return <ol className="my-3 ml-5 list-decimal space-y-1.5 marker:text-muted-foreground/60" {...props} />;
}
function ChatLi(props: ComponentProps<"li">) {
  return <li className="pl-1.5 leading-7" {...props} />;
}
function ChatBlockquote(props: ComponentProps<"blockquote">) {
  return (
    <blockquote
      className="my-4 border-l-4 border-border pl-4 py-1 text-muted-foreground italic"
      {...props}
    />
  );
}
function ChatHr(props: ComponentProps<"hr">) {
  return <hr className="my-6 border-border/50" {...props} />;
}
function ChatLink({
  href = "",
  children,
  node: _node,
  ...props
}: ComponentProps<"a"> & { node?: unknown }) {
  const { workingDirectory, setPreviewSource } = usePanel();
  const target = classifyChatLinkHref(href);
  const linkClass = "inline-flex items-center gap-1 rounded px-1 py-0.5 align-baseline font-medium text-primary no-underline transition-colors hover:bg-primary/10 hover:text-primary";

  if (target.kind === "blocked") {
    return <span title="Blocked URL">{children}</span>;
  }
  if (target.kind === "local-file") {
    const handleLocalFile = (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const absolutePath = resolveToolPath(target.filePath, workingDirectory);
      const classification = classifyPath(absolutePath, workingDirectory);
      setPreviewSource({
        kind: "file",
        filePath: absolutePath,
        trust: classification.trust,
        ...(classification.baseDir ? { baseDir: classification.baseDir } : {}),
        readonly: classification.readonly,
        ...(target.anchor ? { anchor: target.anchor } : {}),
      });
    };
    return (
      <a
        {...props}
        href={target.href}
        className={linkClass}
        data-codepilot-fileref-path={target.filePath}
        {...(target.anchor ? { "data-codepilot-fileref-anchor": target.anchor } : {})}
        onClick={handleLocalFile}
        title={target.filePath + (target.anchor ?? "")}
      >
        <CodexWebIcon name="file_code" size="sm" className="shrink-0" aria-hidden />
        <span>{children}</span>
      </a>
    );
  }
  if (target.kind === "remote") {
    return (
      <a
        {...props}
        href={target.href}
        className={linkClass}
        target="_blank"
        rel="noopener noreferrer"
      >
        <CodexWebIcon name="web_simple" size="sm" className="shrink-0" aria-hidden />
        <span>{children}</span>
      </a>
    );
  }
  return (
    <a
      {...props}
      href={target.href}
      className="font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary"
    >
      {children}
    </a>
  );
}
function ChatStrong(props: ComponentProps<"strong">) {
  return <strong className="font-semibold text-foreground" {...props} />;
}

// `img` — center + rounded; keeps images sane in the chat column.
function ChatImg(props: ComponentProps<"img">) {
  return (
    <img
      className="my-3 max-w-full rounded-lg border border-border/40"
      loading="lazy"
      {...props}
    />
  );
}

// Touch every used elementToString reference so eslint doesn't complain
// in case dead-code elimination misses it; remove if all consumers
// migrate to the DOM-based copy fallback above.
void childrenToText;

export const CHAT_MARKDOWN_COMPONENTS = {
  h1: ChatH1,
  h2: ChatH2,
  h3: ChatH3,
  h4: ChatH4,
  p: ChatParagraph,
  ul: ChatUl,
  ol: ChatOl,
  li: ChatLi,
  blockquote: ChatBlockquote,
  hr: ChatHr,
  a: ChatLink,
  strong: ChatStrong,
  img: ChatImg,
  table: ChatTable,
  thead: ChatTHead,
  tbody: ChatTBody,
  pre: ChatPre,
  code: ChatInlineCode,
} as const;
