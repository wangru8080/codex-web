/**
 * Obsidian callout rewriting — Phase 4 Markdown data layer.
 *
 * Obsidian's callout syntax is:
 *
 *   > [!note] Optional title
 *   > Body line 1
 *   > Body line 2
 *
 *   > [!warning]
 *   > Warning body
 *
 * Streamdown / remark-gfm renders this as a plain blockquote — the
 * `[!type]` marker isn't recognized. Rather than ship a remark
 * plugin we pre-process the markdown body: detect callout-shaped
 * blockquotes and rewrite them into HTML <blockquote> elements with
 * a styling class + an emoji prefix. PreviewPanel's CSS picks the
 * class up and renders the color band.
 *
 * Supported types: note / tip / important / warning / caution / info.
 * Anything else falls through to a default "note" appearance so the
 * page doesn't break on unfamiliar custom types.
 */

export const CALLOUT_TYPES = new Set([
  'note',
  'tip',
  'important',
  'warning',
  'caution',
  'info',
]);

interface CalloutAppearance {
  icon: string;
  label: string;
  className: string;
}

const APPEARANCE: Record<string, CalloutAppearance> = {
  note: { icon: '📝', label: 'Note', className: 'codepilot-callout-note' },
  tip: { icon: '💡', label: 'Tip', className: 'codepilot-callout-tip' },
  important: { icon: '❗', label: 'Important', className: 'codepilot-callout-important' },
  warning: { icon: '⚠️', label: 'Warning', className: 'codepilot-callout-warning' },
  caution: { icon: '🛑', label: 'Caution', className: 'codepilot-callout-caution' },
  info: { icon: 'ℹ️', label: 'Info', className: 'codepilot-callout-info' },
};

const CALLOUT_HEADER = /^>\s*\[!([a-zA-Z]+)\]\s*(.*)$/;

/**
 * Replace Obsidian-style callout blocks with annotated blockquotes
 * that streamdown will render as inline HTML. Non-callout blockquotes
 * are passed through unchanged.
 */
export function rewriteCallouts(body: string): string {
  const lines = body.split(/\r?\n/);
  const output: string[] = [];
  let i = 0;
  // Track fenced code blocks so we don't mistake `> [!note]` inside
  // a code block for a real callout (e.g. when docs *describe* the
  // callout syntax).
  let inFence = false;
  let fenceMarker: string | null = null;
  while (i < lines.length) {
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
      output.push(line);
      i++;
      continue;
    }
    if (inFence) {
      output.push(line);
      i++;
      continue;
    }
    const header = line.match(CALLOUT_HEADER);
    if (!header) {
      output.push(line);
      i++;
      continue;
    }
    const rawType = header[1].toLowerCase();
    const type = CALLOUT_TYPES.has(rawType) ? rawType : 'note';
    const title = header[2].trim();
    const appearance = APPEARANCE[type] ?? APPEARANCE.note;
    // Slurp consecutive blockquote lines that belong to the same callout.
    const bodyLines: string[] = [];
    i++;
    while (i < lines.length && /^>\s?/.test(lines[i])) {
      bodyLines.push(lines[i].replace(/^>\s?/, ''));
      i++;
    }
    // Render as an HTML blockquote so streamdown passes the inline
    // class-bearing element through to the output. Inline-HTML in
    // markdown is left unchanged by the CommonMark spec under most
    // configs.
    // Emit the callout body as a plain markdown blockquote whose
    // FIRST paragraph carries an invisible-to-the-reader marker line:
    // `<!--codepilot-callout:<type>-->`. Streamdown preserves HTML
    // comments inside the rendered DOM (or at least leaves no visible
    // trace), and PreviewPanel's post-render pass picks the marker up
    // and stamps the class on the parent blockquote.
    //
    // Going through a plain markdown blockquote (rather than inline
    // <blockquote class="...">) means streamdown's strong + paragraph
    // formatting works as usual — bold title, regular body — and we
    // don't fight the renderer's sanitizer over class attributes.
    const headerLine = `**${appearance.icon} ${title || appearance.label}**`;
    output.push(`> ${CALLOUT_MARKER_PREFIX}${type}${CALLOUT_MARKER_SUFFIX}`);
    output.push(`> ${headerLine}`);
    if (bodyLines.length) {
      output.push('>');
      for (const ln of bodyLines) output.push('> ' + ln);
    }
  }
  return output.join('\n');
}

/**
 * Marker that survives streamdown's render pipeline (it ends up as a
 * literal text node in the first <p> of the blockquote). PreviewPanel
 * walks blockquotes after each render, detects the marker, stamps the
 * class + data-callout attribute on the blockquote, and removes the
 * marker text so the user never sees it.
 *
 * Choosing a sentinel string instead of an HTML comment avoids
 * fighting whatever HTML-handling mode the streamdown plugin set
 * happens to use today.
 */
export const CALLOUT_MARKER_PREFIX = '⟦codepilot-callout:';
export const CALLOUT_MARKER_SUFFIX = '⟧';

/**
 * Detect a callout marker in a string, returning the callout type or
 * null. Used by the post-render pass + by tests.
 */
export function readCalloutMarker(text: string): string | null {
  const m = text.match(/⟦codepilot-callout:([a-z]+)⟧/);
  return m ? m[1] : null;
}

/**
 * Lookup helper exposed for tests + future tooling: which appearance
 * does a given callout type get? Unknown types fall through to "note".
 */
export function calloutAppearance(rawType: string): CalloutAppearance {
  const t = rawType.toLowerCase();
  return APPEARANCE[t] ?? APPEARANCE.note;
}
