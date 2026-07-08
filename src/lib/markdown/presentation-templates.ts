/**
 * Markdown → HTML presentation templates — Phase 4.C.
 *
 * The Markdown file is the source of truth; this module produces
 * derived HTML in one of four visual templates the user can pick.
 * Each template is a self-contained HTML string (head + body) with
 * inline CSS so the output works as a standalone artifact even when
 * exported / saved / shared.
 *
 * Why inline CSS: the produced HTML can land in three places —
 *   1. `inline-html` PreviewSource (rendered inside the strict-sandbox
 *      iframe in PreviewPanel),
 *   2. `.codepilot/artifacts/<slug>.html` on disk (workspace, opened
 *      later through the html-preview route),
 *   3. The long-shot export pipeline (rendered offscreen, screenshot).
 * Inline CSS sidesteps every relative-stylesheet edge case across
 * those three surfaces.
 *
 * The renderer is deliberately tiny — it converts a subset of Markdown
 * (headings, paragraphs, lists, blockquotes, inline code, code fences,
 * bold/italic, links, images) to HTML. Streamdown in the live preview
 * does the heavy lifting; this is the "we need a stable, dependency-
 * free serializer for the artifact pipeline" copy. It's NOT meant to
 * replace streamdown — only to produce a portable HTML snapshot.
 */

import type { ParsedFrontmatter } from "./frontmatter";

export type PresentationTemplateId = "article" | "report" | "brief" | "pitch";

/**
 * Phase 4 UX — in-place Markdown presentation style for the rendered
 * view. Differs from `PresentationTemplateId` in that it includes a
 * `default` option (minimal styling) and does NOT produce an HTML
 * artifact: the renderer applies it as a CSS class on the rendered
 * body wrapper. Persists per Markdown tab so the user's choice
 * survives reloads.
 */
export type MarkdownPresentationStyle =
  | "default"
  | "article"
  | "report"
  | "brief"
  | "pitch";

export const MARKDOWN_PRESENTATION_STYLES: ReadonlyArray<{
  id: MarkdownPresentationStyle;
  label: string;
  /** Slightly looser tooltip text — describes how the style differs
   *  rather than what it's "for". */
  description: string;
}> = [
  { id: "default", label: "Default", description: "Minimal — same as the legacy preview." },
  { id: "article", label: "Article", description: "Wider line-height, serif body, accent headings." },
  { id: "report", label: "Report", description: "Sans body, dense layout, structured." },
  { id: "brief", label: "Brief", description: "Tight spacing, prominent intro." },
  { id: "pitch", label: "Pitch", description: "Large headings, accent banner." },
];

/**
 * Default presentation style applied when a Markdown source has no
 * explicit `presentationTemplate`. Article is chosen so a freshly
 * opened Markdown is more readable than the v0.54 minimal layout
 * without the user having to do anything.
 */
export const DEFAULT_MARKDOWN_PRESENTATION_STYLE: MarkdownPresentationStyle =
  "article";

export function presentationStyleToTemplateId(
  style: MarkdownPresentationStyle | undefined,
): PresentationTemplateId {
  switch (style) {
    case "report":
    case "brief":
    case "pitch":
    case "article":
      return style;
    case "default":
    default:
      return "article";
  }
}

export function slugifyPresentationArtifactName(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "markdown-artifact";
}

export function buildPresentationArtifactPath(
  sourcePath: string,
  baseDir: string,
): string {
  const trimmedBase = baseDir.replace(/[\\/]+$/, "");
  const filename = sourcePath.split(/[\\/]/).pop() || "markdown";
  const stem = filename.replace(/\.[^./\\]+$/, "");
  return `${trimmedBase}/.codepilot/artifacts/${slugifyPresentationArtifactName(stem)}.html`;
}

interface TemplateDescriptor {
  id: PresentationTemplateId;
  label: string;
  description: string;
  /** Hex / rgba accent color used for headings + chrome */
  accent: string;
  /** Font stack for body text */
  fontFamily: string;
}

export const PRESENTATION_TEMPLATES: ReadonlyArray<TemplateDescriptor> = [
  {
    id: "article",
    label: "Article",
    description: "Long-form reading layout — wide line height, serif body.",
    accent: "#1e3a8a",
    fontFamily:
      "'Georgia', 'Times New Roman', 'Songti SC', 'STSong', serif",
  },
  {
    id: "report",
    label: "Report",
    description: "Dense structured layout — sans body, callout-friendly.",
    accent: "#0f766e",
    fontFamily:
      "system-ui, -apple-system, 'Helvetica Neue', 'PingFang SC', sans-serif",
  },
  {
    id: "brief",
    label: "Brief",
    description: "Single-screen summary — tight spacing, prominent intro.",
    accent: "#b45309",
    fontFamily:
      "system-ui, -apple-system, 'Helvetica Neue', 'PingFang SC', sans-serif",
  },
  {
    id: "pitch",
    label: "Pitch",
    description: "Slide-flavored cards — accent banner, big headings.",
    accent: "#7c3aed",
    fontFamily:
      "system-ui, -apple-system, 'Helvetica Neue', 'PingFang SC', sans-serif",
  },
];

export function getTemplate(id: PresentationTemplateId | string): TemplateDescriptor {
  return (
    PRESENTATION_TEMPLATES.find((t) => t.id === id) ?? PRESENTATION_TEMPLATES[0]
  );
}

export interface RenderPresentationOptions {
  templateId: PresentationTemplateId;
  sourcePath: string;
  body: string;
  frontmatter?: ParsedFrontmatter["data"];
  title?: string;
}

/**
 * Produce a self-contained HTML document from a Markdown body and a
 * chosen template. The output is a string — caller decides whether
 * to drop it into `inline-html`, write to disk, or feed the long-shot
 * exporter.
 *
 * The title comes from (in priority): explicit `title` option, the
 * first `#` heading in the body, then the filename.
 */
export function renderPresentation(opts: RenderPresentationOptions): string {
  const template = getTemplate(opts.templateId);
  const title = pickTitle(opts);
  const bodyHtml = renderMarkdownToHtml(opts.body);
  const css = buildTemplateCss(template);
  const meta = renderMetaStrip(opts.frontmatter, opts.sourcePath);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
</head>
<body>
<div class="codepilot-presentation codepilot-template-${template.id}">
<header class="codepilot-presentation-header">
<h1>${escapeHtml(title)}</h1>
${meta}
</header>
<main class="codepilot-presentation-body">${bodyHtml}</main>
<footer class="codepilot-presentation-footer">
Source: <code>${escapeHtml(opts.sourcePath)}</code>
</footer>
</div>
</body>
</html>`;
}

function pickTitle(opts: RenderPresentationOptions): string {
  if (opts.title) return opts.title;
  const fmTitle = opts.frontmatter?.title;
  if (typeof fmTitle === "string" && fmTitle) return fmTitle;
  const firstHeading = opts.body.match(/^\s*#\s+(.+)$/m);
  if (firstHeading) return firstHeading[1].trim();
  return opts.sourcePath.split(/[/\\]/).pop() || "Untitled";
}

function renderMetaStrip(
  fm: ParsedFrontmatter["data"] | undefined,
  sourcePath: string,
): string {
  if (!fm || Object.keys(fm).length === 0) {
    return `<p class="codepilot-presentation-meta-empty">${escapeHtml(sourcePath)}</p>`;
  }
  const entries = Object.entries(fm).filter(([k]) => k !== "title");
  if (!entries.length) {
    return `<p class="codepilot-presentation-meta-empty">${escapeHtml(sourcePath)}</p>`;
  }
  const items = entries
    .map(([k, v]) => {
      const display = Array.isArray(v) ? v.join(", ") : String(v ?? "");
      return `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(display)}</dd>`;
    })
    .join("");
  return `<dl class="codepilot-presentation-meta">${items}</dl>`;
}

function buildTemplateCss(template: TemplateDescriptor): string {
  return `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 0; background: #f9fafb; color: #111827; font-family: ${template.fontFamily}; line-height: 1.7; }
.codepilot-presentation { max-width: 760px; margin: 0 auto; padding: 3rem 2rem 4rem; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.05); min-height: 100vh; }
.codepilot-presentation-header { border-bottom: 1px solid #e5e7eb; padding-bottom: 1.5rem; margin-bottom: 2rem; }
.codepilot-presentation-header h1 { margin: 0 0 0.5rem; color: ${template.accent}; font-size: 2.25rem; letter-spacing: -0.01em; }
.codepilot-presentation-meta { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0; padding: 0; font-size: 0.85rem; color: #4b5563; }
.codepilot-presentation-meta dt { font-weight: 600; color: ${template.accent}; }
.codepilot-presentation-meta dd { margin: 0; }
.codepilot-presentation-meta-empty { font-size: 0.85rem; color: #6b7280; margin: 0; font-family: monospace; }
.codepilot-presentation-body h1, .codepilot-presentation-body h2, .codepilot-presentation-body h3 { color: ${template.accent}; margin-top: 2rem; margin-bottom: 0.75rem; }
.codepilot-presentation-body h1 { font-size: 1.75rem; }
.codepilot-presentation-body h2 { font-size: 1.35rem; }
.codepilot-presentation-body h3 { font-size: 1.1rem; }
.codepilot-presentation-body p { margin: 0 0 1rem; }
.codepilot-presentation-body ul, .codepilot-presentation-body ol { padding-left: 1.5rem; margin: 0 0 1rem; }
.codepilot-presentation-body li { margin-bottom: 0.25rem; }
.codepilot-presentation-body blockquote { border-left: 3px solid ${template.accent}; padding: 0.5rem 1rem; margin: 0 0 1rem; background: #f3f4f6; color: #1f2937; }
.codepilot-presentation-body pre { background: #0f172a; color: #e2e8f0; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; }
.codepilot-presentation-body code { background: #f3f4f6; padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.9em; }
.codepilot-presentation-body pre code { background: transparent; padding: 0; }
.codepilot-presentation-body a { color: ${template.accent}; }
.codepilot-presentation-body img { max-width: 100%; height: auto; }
.codepilot-presentation-footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; font-size: 0.75rem; color: #6b7280; }
.codepilot-template-brief .codepilot-presentation { padding: 2rem 2rem; }
.codepilot-template-brief .codepilot-presentation-header { padding-bottom: 0.75rem; margin-bottom: 1rem; }
.codepilot-template-brief .codepilot-presentation-header h1 { font-size: 1.75rem; }
.codepilot-template-pitch .codepilot-presentation { background: linear-gradient(180deg, ${template.accent}10 0%, #ffffff 240px); }
.codepilot-template-pitch .codepilot-presentation-header h1 { font-size: 2.75rem; }
.codepilot-template-report .codepilot-presentation-body { font-size: 0.95rem; }
`;
}

/**
 * Tiny Markdown → HTML serializer. Handles the subset needed for the
 * presentation artifact: headings, paragraphs, ordered/unordered
 * lists, blockquotes, fenced code, inline code, bold, italic, links,
 * images. Anything more exotic (tables, footnotes, MDX) falls through
 * as escaped text. Streamdown handles the rich case in the live
 * preview; this serializer exists for the standalone artifact.
 */
export function renderMarkdownToHtml(source: string): string {
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];

  function flushParagraph(buf: string[]) {
    if (buf.length === 0) return;
    out.push(`<p>${renderInline(buf.join(" ").trim())}</p>`);
  }

  let pBuf: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    if (inCode) {
      if (/^```/.test(line)) {
        out.push(
          `<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeBuf.join("\n"))}</code></pre>`,
        );
        inCode = false;
        codeLang = "";
        codeBuf = [];
      } else {
        codeBuf.push(line);
      }
      i++;
      continue;
    }
    const fenceOpen = line.match(/^```(\w*)/);
    if (fenceOpen) {
      flushParagraph(pBuf);
      pBuf = [];
      inCode = true;
      codeLang = fenceOpen[1] || "";
      codeBuf = [];
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph(pBuf);
      pBuf = [];
      const lvl = heading[1].length;
      out.push(`<h${lvl}>${renderInline(heading[2])}</h${lvl}>`);
      i++;
      continue;
    }
    const ulItem = line.match(/^\s*[-*]\s+(.+)$/);
    if (ulItem) {
      flushParagraph(pBuf);
      pBuf = [];
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*[-*]\s+(.+)$/);
        if (!m) break;
        items.push(`<li>${renderInline(m[1])}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    const olItem = line.match(/^\s*\d+\.\s+(.+)$/);
    if (olItem) {
      flushParagraph(pBuf);
      pBuf = [];
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+\.\s+(.+)$/);
        if (!m) break;
        items.push(`<li>${renderInline(m[1])}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      flushParagraph(pBuf);
      pBuf = [];
      const bqLines: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^>\s?(.*)$/);
        if (!m) break;
        bqLines.push(m[1]);
        i++;
      }
      out.push(`<blockquote>${renderInline(bqLines.join(" ")) || "&nbsp;"}</blockquote>`);
      continue;
    }
    if (line.trim() === "") {
      flushParagraph(pBuf);
      pBuf = [];
      i++;
      continue;
    }
    pBuf.push(line);
    i++;
  }
  flushParagraph(pBuf);
  return out.join("\n");
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  // Order matters: image before link, bold before italic.
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) =>
    `<img alt="${alt}" src="${url}">`,
  );
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    `<a href="${url}">${label}</a>`,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return out;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
