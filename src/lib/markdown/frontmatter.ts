/**
 * YAML frontmatter splitter for Markdown previews — Phase 4 Markdown data layer.
 *
 * Frontmatter is the metadata block at the very top of a `.md` file
 * delimited by `---` lines, e.g.
 *
 *   ---
 *   title: My Note
 *   tags: [draft, idea]
 *   created: 2026-05-12
 *   ---
 *
 *   Body content here.
 *
 * We don't need a full YAML 1.2 implementation — the typical CodexWeb /
 * Obsidian frontmatter is a flat map with strings, numbers, booleans,
 * dates, and one-level lists. A purpose-built tiny parser keeps us off
 * the js-yaml runtime cost for what's essentially a metadata sidecar.
 *
 * Output:
 *  - `data`        : key→value map (string / number / boolean / string[])
 *  - `body`        : the rest of the markdown content (frontmatter stripped)
 *  - `lineOffset`  : how many lines the frontmatter occupied — used by
 *                    line-anchor jumps so `:12` lands at the right place
 *                    even after we strip frontmatter for rendering.
 *
 * The body is returned verbatim; we do NOT touch its line endings or
 * leading whitespace beyond removing the `---\n…\n---\n` block.
 */

export type FrontmatterValue = string | number | boolean | string[] | null;

export interface ParsedFrontmatter {
  data: Record<string, FrontmatterValue>;
  body: string;
  /** Number of lines the frontmatter block occupies (including the
   *  trailing `---` line). Zero when no frontmatter is present. */
  lineOffset: number;
}

const FRONTMATTER_OPEN = /^---\s*\r?\n/;

/**
 * Split a Markdown source into `{ data, body, lineOffset }`. When no
 * frontmatter is detected, returns an empty data map and the input
 * verbatim as the body.
 */
export function parseFrontmatter(source: string): ParsedFrontmatter {
  if (!FRONTMATTER_OPEN.test(source)) {
    return { data: {}, body: source, lineOffset: 0 };
  }
  // Skip the opening `---` line and look for the closing `---`.
  const afterOpen = source.replace(FRONTMATTER_OPEN, '');
  const closingMatch = afterOpen.match(/\r?\n---\s*(?:\r?\n|$)/);
  if (!closingMatch || closingMatch.index === undefined) {
    // Unterminated — treat as if there's no frontmatter so we don't
    // accidentally strip the entire document.
    return { data: {}, body: source, lineOffset: 0 };
  }
  const yamlText = afterOpen.slice(0, closingMatch.index);
  const body = afterOpen.slice(closingMatch.index + closingMatch[0].length);
  const data = parseSimpleYaml(yamlText);
  // The block is: opening line + yaml lines + closing line.
  const lineOffset = 1 + yamlText.split(/\r?\n/).length + 1;
  return { data, body, lineOffset };
}

/**
 * Parse a flat YAML key/value block.
 *
 * Grammar (the only subset we support):
 *   key: scalar
 *   key: [item1, item2, item3]
 *   key:
 *     - item1
 *     - item2
 *
 * Scalars are auto-coerced to number / boolean / null when they match
 * the canonical YAML literals; otherwise they're strings (with optional
 * surrounding single or double quotes stripped).
 */
function parseSimpleYaml(yamlText: string): Record<string, FrontmatterValue> {
  const out: Record<string, FrontmatterValue> = {};
  const lines = yamlText.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rawValue = m[2].trim();
    if (rawValue === '' && i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
      // Multi-line list
      const items: string[] = [];
      i++;
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*-\s+/, '').trim();
        items.push(unquote(itemText));
        i++;
      }
      out[key] = items;
      continue;
    }
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1);
      out[key] = inner
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(unquote);
    } else {
      out[key] = coerceScalar(rawValue);
    }
    i++;
  }
  return out;
}

function unquote(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function coerceScalar(raw: string): FrontmatterValue {
  if (raw === '' || raw === '~' || raw === 'null') return null;
  if (raw === 'true' || raw === 'True') return true;
  if (raw === 'false' || raw === 'False') return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);
  return unquote(raw);
}

/**
 * Format a frontmatter value for display in the metadata panel.
 * Arrays render as comma-joined; everything else falls through to
 * String() which gives stable formatting for the small set of types
 * the parser produces.
 */
export function formatFrontmatterValue(value: FrontmatterValue): string {
  if (value === null) return '—';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
