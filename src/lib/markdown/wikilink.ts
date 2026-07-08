/**
 * Obsidian-style wikilink rewriting for streamdown — Phase 4 Markdown data layer.
 *
 * Streamdown / remark-gfm doesn't recognize `[[Note]]` natively. Rather
 * than ship a full remark plugin, we pre-process the markdown text
 * before it reaches the renderer, rewriting wikilinks into standard
 * markdown links with a `codepilot:` scheme. PreviewPanel then
 * intercepts link clicks with that scheme and feeds them through
 * the existing PreviewSource / trust-tier pipeline.
 *
 * Recognized forms:
 *   [[Foo]]         → link text "Foo",   target "Foo"
 *   [[Foo|alias]]   → link text "alias", target "Foo"
 *   [[Foo#Heading]] → link text "Foo > Heading", target "Foo#Heading"
 *   [[Foo|alias]]   with alias overrides the auto display text.
 *
 * Wikilinks inside code spans (`like this`) or fenced code blocks must
 * NOT be rewritten — they're often literal demonstrations of the
 * syntax.
 */

const WIKILINK_TOKEN = /\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

export interface WikilinkTarget {
  /** The note name (without .md extension), optionally with a #heading. */
  target: string;
  /** Display text — alias when present, otherwise the target verbatim. */
  display: string;
}

/**
 * Rewrite `[[Note]]` tokens into `[Note](codepilot://wikilink/Note)`
 * markdown links so streamdown renders them as <a> elements. Skips
 * occurrences inside code spans and fenced code blocks.
 */
export function rewriteWikilinks(body: string): string {
  const lines = body.split(/\r?\n/);
  let inFence = false;
  let fenceMarker: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(\s{0,3})(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0];
      } else if (fenceMarker && marker.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;
    lines[i] = rewriteLine(line);
  }
  return lines.join('\n');
}

/**
 * Wikilink URL scheme — fragment-style so the markdown renderer's URL
 * sanitizer (which blocks unknown schemes like `codepilot:`) lets the
 * link through. The browser would naturally try to scroll to an id of
 * the same name on the current page; the PreviewPanel intercepts the
 * click before navigation and routes to setPreviewSource.
 *
 * The target name is URL-encoded then prefixed; PreviewPanel's
 * onClick handler decodes via `parseWikilinkHref`.
 */
export const WIKILINK_HREF_PREFIX = '#codepilot-wikilink-';

function rewriteLine(line: string): string {
  // Skip inline code spans — preserve them verbatim, rewrite around them.
  const codeSpans: Array<{ start: number; end: number }> = [];
  for (const match of line.matchAll(/`[^`]+`/g)) {
    if (match.index !== undefined) {
      codeSpans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  function inCodeSpan(idx: number): boolean {
    return codeSpans.some((s) => idx >= s.start && idx < s.end);
  }
  return line.replace(WIKILINK_TOKEN, (full, target, alias, offset: number) => {
    if (inCodeSpan(offset)) return full;
    const t = target.trim();
    const a = alias?.trim() || displayFor(t);
    // Fragment-style href: passes streamdown's URL sanitizer (it's the
    // same-page hash form), and the click handler in PreviewPanel
    // intercepts before the browser tries to scroll.
    const href = `${WIKILINK_HREF_PREFIX}${encodeURIComponent(t)}`;
    return `[${a}](${href})`;
  });
}

/**
 * Inverse of the rewriter — extract the wikilink target from a
 * rendered anchor's `href`. Returns null when the href is not a
 * wikilink hash; callers can ignore the click in that case.
 */
export function parseWikilinkHref(href: string | null | undefined): string | null {
  if (!href || !href.startsWith(WIKILINK_HREF_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(WIKILINK_HREF_PREFIX.length));
  } catch {
    return null;
  }
}

/**
 * Resolve a wikilink target into a filesystem path against the active
 * workspace. The target may include a `#heading` fragment that we keep
 * separately so callers can pass the anchor through to PreviewSource.
 *
 * Returns null when no workingDirectory is available — callers should
 * treat that as "can't resolve, leave as a no-op link."
 */
export function resolveWikilink(
  target: WikilinkTarget['target'],
  workingDirectory: string | null | undefined,
): { absolutePath: string; anchor?: string } | null {
  if (!workingDirectory) return null;
  const [bareTarget, headingFragment] = splitOnHash(target);
  const name = bareTarget.replace(/\.md$/i, '');
  if (!name) return null;
  const sep = workingDirectory.includes('\\') ? '\\' : '/';
  const filename = `${name}.md`;
  const absolutePath = `${workingDirectory.replace(/[/\\]$/, '')}${sep}${filename}`;
  return headingFragment
    ? { absolutePath, anchor: `#${headingFragment}` }
    : { absolutePath };
}

function splitOnHash(raw: string): [string, string | undefined] {
  const idx = raw.indexOf('#');
  if (idx < 0) return [raw, undefined];
  return [raw.slice(0, idx), raw.slice(idx + 1)];
}

function displayFor(target: string): string {
  const [bare, anchor] = splitOnHash(target);
  if (!anchor) return bare;
  return `${bare} › ${anchor.replace(/[-_]/g, ' ')}`;
}

/**
 * Pull every wikilink token out of a body — used by tests + by callers
 * that want to surface "this note links to X, Y, Z" affordances later.
 */
export function extractWikilinks(body: string): WikilinkTarget[] {
  const out: WikilinkTarget[] = [];
  const lines = body.split(/\r?\n/);
  let inFence = false;
  for (const line of lines) {
    if (/^(\s{0,3})(```+|~~~+)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const m of line.matchAll(WIKILINK_TOKEN)) {
      const target = m[1].trim();
      const alias = m[2]?.trim();
      out.push({ target, display: alias || displayFor(target) });
    }
  }
  return out;
}
