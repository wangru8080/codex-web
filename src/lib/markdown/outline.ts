/**
 * Markdown outline parser — Phase 4 Markdown data layer.
 *
 * Produces a flat heading list with slug ids that the outline rail
 * uses to render entries and that the post-render anchor jump uses
 * to scrollIntoView. The slug must match what the rendered Markdown
 * heading element ends up with — we generate the slug here AND inject
 * it onto the heading DOM node after streamdown renders, so the two
 * sides agree without depending on a specific markdown library's
 * built-in slug behaviour.
 *
 * Headings inside fenced code blocks must NOT be collected — a `#`
 * line inside ```bash isn't a heading. The parser tracks a fence
 * state so it can skip those.
 */

export interface OutlineHeading {
  /** 1-6, matching markdown heading depth */
  level: number;
  /** Raw heading text after stripping leading `#`s */
  text: string;
  /** GitHub-style slug — lowercase, alphanumerics + dashes */
  slug: string;
  /** 1-indexed line number in the source body the heading was parsed
   *  from. Useful for line-based anchor jumps. */
  line: number;
}

/**
 * Parse Markdown body into an ordered heading list. The body should
 * already have frontmatter stripped — passing raw source with `---`
 * frontmatter is fine too, but the line numbers won't include the
 * frontmatter offset (callers compose this themselves if needed).
 */
export function parseOutline(body: string): OutlineHeading[] {
  const lines = body.split(/\r?\n/);
  const headings: OutlineHeading[] = [];
  // Slug collision counter — duplicate text gets `-2`, `-3`, etc., the
  // same convention rehype-slug uses.
  const seen = new Map<string, number>();
  let inFence = false;
  let fenceMarker: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceOpen = line.match(/^(\s{0,3})(```+|~~~+)/);
    if (fenceOpen) {
      const marker = fenceOpen[2];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0]; // remember backtick vs tilde
      } else if (fenceMarker && marker.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;
    const hMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!hMatch) continue;
    const level = hMatch[1].length;
    const text = hMatch[2].trim();
    const baseSlug = slugify(text);
    const count = (seen.get(baseSlug) ?? 0) + 1;
    seen.set(baseSlug, count);
    const slug = count > 1 ? `${baseSlug}-${count}` : baseSlug;
    headings.push({ level, text, slug, line: i + 1 });
  }
  return headings;
}

/**
 * GitHub-style slugger. Lowercases, replaces whitespace runs with
 * dashes, strips characters outside `[a-z0-9-_]`. Matches what the
 * Markdown ecosystem (rehype-slug, GitHub itself) produces for the
 * vast majority of heading text.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    // Keep Unicode letters/digits/whitespace; strip everything else.
    // The hyphen/underscore are kept via explicit listing alongside
    // \p{L}\p{N}\s to avoid TS regex-class-range warnings.
    .replace(/[^\p{L}\p{N}\s_\-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}
