/**
 * Anchor parsing for PreviewSource — Phase 4 Markdown data layer.
 *
 * A PreviewSource of kind `file` may carry an `anchor` string that
 * tells the panel where to scroll after the content loads. Three
 * forms are accepted, in this order of preference:
 *
 *   1. `#L12`         → line-jump (1-indexed)
 *   2. `:12`          → line-jump (alternate Codex-style)
 *   3. `#heading-id`  → heading slug (rendered Markdown only)
 *
 * The classifier returns a discriminated union so callers can branch
 * on the kind without re-parsing.
 *
 * Round-trip: the helpers here are pure and synchronous so unit tests
 * can pin the parser independently of the React surface.
 */

export type ParsedAnchor =
  | { kind: 'line'; line: number }
  | { kind: 'heading'; slug: string }
  | { kind: 'invalid' };

/**
 * Parse a raw anchor string. Empty / nullish input → invalid.
 *
 * Line numbers are clamped to ≥ 1 by the parser; values like `:0` or
 * negative numbers fall through to `invalid` so callers don't have to
 * second-guess where the cursor should land.
 */
export function parseAnchor(raw: string | null | undefined): ParsedAnchor {
  if (!raw) return { kind: 'invalid' };
  const s = raw.trim();
  if (!s) return { kind: 'invalid' };

  // Form 1: #L12 (case insensitive on the L)
  const lineMatch = s.match(/^#L(\d+)$/i);
  if (lineMatch) {
    const n = Number(lineMatch[1]);
    return n >= 1 ? { kind: 'line', line: n } : { kind: 'invalid' };
  }

  // Form 2: :12 (and optionally :12:34 — column is currently ignored
  // but parsed so a future column-jump doesn't break)
  const colonMatch = s.match(/^:(\d+)(?::\d+)?$/);
  if (colonMatch) {
    const n = Number(colonMatch[1]);
    return n >= 1 ? { kind: 'line', line: n } : { kind: 'invalid' };
  }

  // Form 3: #heading-slug
  if (s.startsWith('#')) {
    const slug = s.slice(1).trim();
    if (!slug) return { kind: 'invalid' };
    return { kind: 'heading', slug };
  }

  return { kind: 'invalid' };
}

/**
 * Split a filesystem path that may carry an inline anchor at the end
 * — common in Codex-style output:
 *
 *   /abs/path/file.md:12       → { filePath, anchor: ':12' }
 *   file.md#L12                → { filePath, anchor: '#L12' }
 *   /abs/path/file.md#heading  → { filePath, anchor: '#heading' }
 *   /abs/path/file.md          → { filePath, anchor: undefined }
 *
 * The classifier only splits when the trailing fragment LOOKS like a
 * line number or heading anchor — a colon in the middle of a path on
 * Windows (`C:\Users\...`) must not be mistaken for `:12`.
 */
export function splitPathAndAnchor(input: string): {
  filePath: string;
  anchor?: string;
} {
  // Trailing :NNN at the very end of the string is treated as a line
  // anchor. The match anchors to end-of-string so mid-path colons
  // (Windows drive, schemes) are not affected.
  const lineColon = input.match(/^(.+?)(:\d+(?::\d+)?)$/);
  if (lineColon) {
    return { filePath: lineColon[1], anchor: lineColon[2] };
  }
  // `#L12` or `#heading` — only treat as anchor if the # is preceded
  // by what looks like a file path (has a dot or slash before it).
  const hash = input.lastIndexOf('#');
  if (hash > 0) {
    const before = input.slice(0, hash);
    const after = input.slice(hash);
    if (/[./\\]/.test(before)) {
      return { filePath: before, anchor: after };
    }
  }
  return { filePath: input };
}
