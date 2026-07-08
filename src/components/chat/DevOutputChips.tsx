"use client";

/**
 * Dev-output reference chips — Phase 4.D, fence-safe rewrite (P1.1).
 *
 * Previous approach: tokenize the raw assistant markdown and render
 * each text token through its own MessageResponse. That sliced
 * through fenced code blocks (`/abs/foo.md:12` inside ```ts became
 * a chip), inline code (`src/foo.ts` inside backticks did too), and
 * markdown links (path inside `[label](path)` got chip-ified).
 *
 * New approach: render the full markdown through ONE MessageResponse
 * (so streamdown owns code-fence / link / bold parsing), then run a
 * post-render DOM walk over text nodes whose ancestor chain does NOT
 * include `<pre>`, `<code>`, or `<a>`. Tokenize each safe text node
 * and splice in chip <button> elements. Markdown links that look
 * like local file references get intercepted in a separate pass.
 *
 * The chip elements carry their target metadata on `data-*`
 * attributes; one container-level click listener routes through
 * setPreviewSource. No React portals, no innerHTML rewrites — we
 * mutate plain DOM nodes that React doesn't manage (they live inside
 * a ref'd div and the tree underneath comes from streamdown's
 * dangerouslySetInnerHTML / its react renderer of static markdown
 * output, which it doesn't reconcile across re-renders unless the
 * markdown content itself changes).
 */

import { useEffect, useRef, useCallback, useMemo } from "react";
import type React from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { usePanel } from "@/hooks/usePanel";
import { classifyPath } from "@/lib/preview-source";
import {
  tokenizeDevOutput,
  type DevOutputToken,
} from "@/lib/markdown/dev-output-parser";
import { splitPathAndAnchor } from "@/lib/markdown/anchor";
import { looksLikeRemoteHref, isPotentialLocalFile } from "@/lib/markdown/local-link-detector";
import { resolveToolPath } from "@/lib/file-write-tools";

/** Tag names whose subtree we never tokenize — letting markdown
 *  structure stand. Code (fenced or inline) and existing links must
 *  not be sliced into multiple text fragments. */
const SKIP_TAGS = new Set(["PRE", "CODE", "A", "BUTTON"]);

/** Marker set on processed text-node parents so re-renders don't
 *  re-process already-chipified content. */
const PROCESSED_ATTR = "data-codepilot-dev-processed";

export function DevOutputSegment({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { workingDirectory, setPreviewSource } = usePanel();

  // Click delegation — single listener at the container catches every
  // chip + intercepted markdown-link click.
  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const el = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-codepilot-fileref-path], [data-codepilot-localhost-action]",
      );
      if (!el) return;
      const rawFilePath = el.getAttribute("data-codepilot-fileref-path");
      if (rawFilePath) {
        event.preventDefault();
        event.stopPropagation();
        const anchor = el.getAttribute("data-codepilot-fileref-anchor") ?? undefined;
        // Phase 4 P1.1 — relative / bare paths must be resolved
        // against the active workingDirectory BEFORE classifyPath.
        // classifyPath uses absolute-path-under-cwd to decide between
        // workspace and agent-referenced; feeding it a bare
        // `README.md` would always classify as agent-referenced and
        // then read from homeDir after the user confirmed — not the
        // workspace file the user meant.
        const absolutePath = resolveToolPath(rawFilePath, workingDirectory);
        const cls = classifyPath(absolutePath, workingDirectory);
        setPreviewSource({
          kind: "file",
          filePath: absolutePath,
          trust: cls.trust,
          ...(cls.baseDir ? { baseDir: cls.baseDir } : {}),
          readonly: cls.readonly,
          ...(anchor ? { anchor } : {}),
        });
        return;
      }
      const action = el.getAttribute("data-codepilot-localhost-action");
      const url = el.getAttribute("data-codepilot-localhost-url");
      if (!action || !url) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "browser") {
        if (typeof window !== "undefined") {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      // Artifact: render a minimal redirector inside an inline-html
      // panel. CSP mode is 'navigate' so the meta-refresh actually
      // fires; everything else is locked down by the injected CSP.
      const safeUrl = url
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      const redirector =
        `<!doctype html><html><head><meta http-equiv="refresh" content="0; url=${safeUrl}"></head>` +
        `<body><a href="${safeUrl}">${safeUrl}</a></body></html>`;
      setPreviewSource({
        kind: "inline-html",
        html: redirector,
        virtualName: url,
        cspMode: "navigate",
      });
    },
    [workingDirectory, setPreviewSource],
  );

  // Post-render enrichment. Runs after streamdown has rendered the
  // markdown into our container. The walker visits text nodes
  // outside skip tags and rewrites them in place; <a> tags whose
  // href looks like a local file reference get an intercepting
  // wrapper so clicking opens the file in PreviewPanel rather than
  // letting the browser navigate to a non-existent URL.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    enrichDevOutputInDom(root);
  });

  // Phase 4 P1.2 — custom link renderer for THIS DevOutputSegment only.
  // Streamdown's default link safety converts unknown / unrecognised
  // hrefs into inert <button> elements; that prevents our
  // post-render <a[href]> walker from finding local-file Markdown
  // links like `[label](README.md#L12)`. Rather than disable chat
  // link safety globally (which would unwrap arbitrary http links),
  // we provide a `components.a` override that handles three cases:
  //   1. Local file path → render <a> with data-* attributes so the
  //      container's click handler intercepts and routes through
  //      setPreviewSource (resolved against workingDirectory).
  //   2. Safe remote scheme (http/https/mailto/tel) → render an
  //      anchor with target=_blank + rel="noopener noreferrer".
  //   3. Anything else → render a plain span so the URL never
  //      navigates the browser.
  const linkRenderer = useMemo(
    () =>
      function CodepilotLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
        const { href, children, ...rest } = props;
        const safeHref = typeof href === "string" ? href : "";
        const { filePath: rawFilePath, anchor } = splitPathAndAnchor(safeHref);
        const isRemote = looksLikeRemoteHref(safeHref);
        if (!isRemote && isPotentialLocalFile(rawFilePath)) {
          return (
            <a
              href={safeHref}
              data-codepilot-fileref-path={rawFilePath}
              {...(anchor ? { "data-codepilot-fileref-anchor": anchor } : {})}
              {...rest}
            >
              {children}
            </a>
          );
        }
        if (/^(?:https?|mailto|tel):/i.test(safeHref)) {
          return (
            <a href={safeHref} target="_blank" rel="noopener noreferrer" {...rest}>
              {children}
            </a>
          );
        }
        // Anything else (javascript:, data:, unknown schemes) → inert span.
        return <span title="Blocked URL">{children}</span>;
      },
    [],
  );

  return (
    <div ref={containerRef} onClick={onClick}>
      <MessageResponse components={{ a: linkRenderer }}>{text}</MessageResponse>
    </div>
  );
}

/**
 * Walk the rendered DOM and turn dev-output references into chips.
 * Exported for unit tests + for future reuse on other markdown-rendering
 * surfaces.
 *
 * Algorithm:
 *   1. Iterate text nodes via TreeWalker, skip nodes whose ancestor
 *      chain contains PRE / CODE / A / BUTTON.
 *   2. For each candidate text node, run the tokenizer. If only one
 *      `text` token, leave the node alone.
 *   3. Otherwise build a DocumentFragment alternating text + chip
 *      spans; replace the original text node with the fragment.
 *   4. Stamp the parent element with PROCESSED_ATTR so future
 *      passes ignore it.
 *   5. Separately, walk <a> elements. If an anchor's href looks like
 *      a local file (no scheme + previewable extension OR abs path),
 *      stamp it with the same data-* attributes so the container's
 *      click handler intercepts it.
 */
export function enrichDevOutputInDom(root: HTMLElement): void {
  enrichTextNodes(root);
  enrichLocalFileLinks(root);
}

function enrichTextNodes(root: HTMLElement): void {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip empty / whitespace-only nodes — nothing to tokenize.
      const value = (node as Text).nodeValue;
      if (!value || !value.trim()) return NodeFilter.FILTER_REJECT;
      // Skip if any ancestor is a skip tag or already processed.
      let cursor: Node | null = node.parentNode;
      while (cursor && cursor !== root) {
        if (cursor.nodeType === 1 /* ELEMENT_NODE */) {
          const el = cursor as Element;
          if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
          if (el.hasAttribute(PROCESSED_ATTR)) return NodeFilter.FILTER_REJECT;
        }
        cursor = cursor.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    targets.push(n as Text);
    n = walker.nextNode();
  }

  for (const textNode of targets) {
    const tokens = tokenizeDevOutput(textNode.nodeValue ?? "");
    if (tokens.length <= 1 && tokens[0]?.kind === "text") continue;
    if (!tokens.some((t) => t.kind !== "text")) continue;
    const fragment = doc.createDocumentFragment();
    for (const tok of tokens) {
      fragment.appendChild(buildTokenNode(doc, tok));
    }
    const parent = textNode.parentElement;
    textNode.replaceWith(fragment);
    parent?.setAttribute(PROCESSED_ATTR, "1");
  }
}

function buildTokenNode(doc: Document, tok: DevOutputToken): Node {
  if (tok.kind === "text") return doc.createTextNode(tok.value);
  if (tok.kind === "file-ref") {
    const basename = tok.filePath.split(/[/\\]/).pop() ?? tok.filePath;
    const btn = doc.createElement("button");
    btn.setAttribute("type", "button");
    btn.setAttribute("data-codepilot-fileref-path", tok.filePath);
    if (tok.anchor) btn.setAttribute("data-codepilot-fileref-anchor", tok.anchor);
    btn.className =
      "inline-flex items-baseline gap-1 rounded border border-border/60 bg-muted/50 px-1.5 align-baseline text-[11px] font-mono text-foreground hover:bg-muted hover:border-border";
    btn.title = tok.filePath + (tok.anchor ?? "");
    btn.appendChild(doc.createTextNode(basename));
    if (tok.anchor) {
      const anchorSpan = doc.createElement("span");
      anchorSpan.className = "text-muted-foreground/70";
      anchorSpan.appendChild(doc.createTextNode(tok.anchor));
      btn.appendChild(anchorSpan);
    }
    return btn;
  }
  // localhost-url
  const wrap = doc.createElement("span");
  wrap.className = "inline-flex items-baseline gap-1 align-baseline";
  const code = doc.createElement("code");
  code.className =
    "rounded border border-border/40 bg-muted/40 px-1 text-[11px] text-foreground";
  code.appendChild(doc.createTextNode(tok.url.replace(/^https?:\/\//, "").replace(/\/$/, "")));
  wrap.appendChild(code);
  for (const [action, label] of [
    ["browser", "Browser"],
    ["artifact", "Artifact"],
  ] as const) {
    const b = doc.createElement("button");
    b.setAttribute("type", "button");
    b.setAttribute("data-codepilot-localhost-action", action);
    b.setAttribute("data-codepilot-localhost-url", tok.url);
    b.className =
      "rounded border border-border/60 bg-background px-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground";
    b.appendChild(doc.createTextNode(label));
    wrap.appendChild(b);
  }
  return wrap;
}

function enrichLocalFileLinks(root: HTMLElement): void {
  const anchors = root.querySelectorAll<HTMLAnchorElement>("a[href]");
  anchors.forEach((a) => {
    if (a.hasAttribute("data-codepilot-fileref-path")) return;
    const href = a.getAttribute("href") ?? "";
    if (!href) return;
    if (looksLikeRemoteHref(href)) return;
    // Resolve into file-ref-shaped data — same anchor parser as the
    // bare chip path so behavior stays consistent.
    const { filePath, anchor } = splitPathAndAnchor(href);
    if (!isPotentialLocalFile(filePath)) return;
    a.setAttribute("data-codepilot-fileref-path", filePath);
    if (anchor) a.setAttribute("data-codepilot-fileref-anchor", anchor);
  });
}

// looksLikeRemoteHref + isPotentialLocalFile live in
// `src/lib/markdown/local-link-detector.ts` so the link-interception
// contract can be unit-tested without jsdom.
