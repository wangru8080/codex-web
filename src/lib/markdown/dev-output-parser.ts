/**
 * Dev-output format adaptation — Phase 4.D.
 *
 * AI / Codex output frequently contains "engineer-ish" references that
 * are useful when clicked: file paths with optional line anchors,
 * localhost URLs, diff fences. This module turns a chunk of text into
 * a list of tokens — plain text + typed references — so the chat
 * renderer can replace the typed references with interactive chips.
 *
 * Coverage:
 *   - `/abs/path/file.ext`                — abs path
 *   - `/abs/path/file.ext:12`             — abs path + line
 *   - `/abs/path/file.ext:12:5`           — abs path + line + col
 *   - `relative/file.ext`                 — relative path (has dir sep)
 *   - `relative/file.ext:12`              — relative + line
 *   - `file.ext#L12`                      — file + heading-anchor-style line
 *   - `http://localhost:PORT/...`         — localhost URL
 *   - `https://localhost:PORT/...`        — localhost URL (TLS dev)
 *   - `http://127.0.0.1:PORT/...`         — localhost URL (numeric)
 *
 * Markdown links of the form `[label](path)` are not re-tokenized
 * here — the chat renderer already handles them via streamdown's link
 * pipeline. This module focuses on bare references that appear in
 * regular prose / log dumps.
 */

/**
 * File extensions we know how to preview. References that don't end
 * in one of these still get tokenized as `file-ref` so the chip can
 * open them as plain text, but the Preview chip stays inert.
 */
export const PREVIEWABLE_FILE_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".html",
  ".htm",
  ".json",
  ".csv",
  ".tsv",
  ".jsx",
  ".tsx",
  ".txt",
  ".log",
]);

export type DevOutputToken =
  | { kind: "text"; value: string }
  | {
      kind: "file-ref";
      value: string;
      /** The bare path without the anchor suffix */
      filePath: string;
      /** Anchor in normalized form: `:12` / `:12:5` / `#L12` / `#slug` */
      anchor?: string;
      /** True when the path has one of the previewable extensions —
       *  chat surface enables a Preview action only in that case. */
      previewable: boolean;
    }
  | { kind: "localhost-url"; value: string; url: string };

/**
 * Tokenize a piece of text into a flat list of `text` and reference
 * tokens. Concatenating `value` across all tokens reconstructs the
 * input exactly — useful for tests + for callers that want to render
 * around references without losing whitespace.
 *
 * Recognized references (in priority order so localhost URL doesn't
 * fall through to the file pattern that matches `.../foo:3000`):
 *
 *   1. localhost URLs (http / https / 127.0.0.1, with optional port + path)
 *   2. absolute file path with extension (POSIX `/abs/foo.md` or
 *      Windows `C:\abs\foo.md`), optionally + `:N` or `:N:M` or `#L\d+`
 *   3. relative file path with separator (at least one `/`) + extension
 *      + optional anchor
 *   4. bare filename ending in a PREVIEWABLE_FILE_EXTENSIONS extension
 *      + optional anchor — only fires for the small whitelist so prose
 *      words like "okay.md" only match when `.md` is in the whitelist,
 *      which it intentionally is (Markdown filenames are the most
 *      common bare reference in chat).
 *
 * Bare filename detection (#4) requires the previewable-extension
 * list rather than `[A-Za-z0-9]+` so we don't tokenize tokens like
 * "thanks.thanks" or "version1.0" as file paths.
 */
export function tokenizeDevOutput(input: string): DevOutputToken[] {
  if (!input) return [];
  const out: DevOutputToken[] = [];
  // The combined regex tries each branch in order. Capture groups:
  //   m[1] = localhost URL
  //   m[2] = absolute path (POSIX or Windows)
  //   m[3] = relative path with separator
  //   m[4] = bare filename whitelisted by previewable extension
  const bareExtensions = [...PREVIEWABLE_FILE_EXTENSIONS]
    .map((e) => e.replace(/^\./, ''))
    .join('|');
  const combined = new RegExp(
    [
      // Localhost URL
      '(https?:\\/\\/(?:localhost|127\\.0\\.0\\.1)(?::\\d+)?(?:\\/[^\\s)\\]]*)?)',
      // Absolute file path + optional anchor
      '((?:\\/|(?:[A-Za-z]:\\\\))[^\\s)\\],]+?\\.[A-Za-z0-9]+(?:#L\\d+|:\\d+(?::\\d+)?)?)',
      // Relative file path with separator + extension + optional anchor
      '((?:[\\w.-]+\\/)+[\\w.-]+\\.[A-Za-z0-9]+(?:#L\\d+|:\\d+(?::\\d+)?)?)',
      // Bare filename — must be a previewable extension AND surrounded
      // by word boundaries so prose words don't get tokenized.
      `(\\b[\\w.-]+\\.(?:${bareExtensions})(?:#L\\d+|:\\d+(?::\\d+)?)?\\b)`,
    ].join('|'),
    'g',
  );
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = combined.exec(input)) !== null) {
    const matchStart = m.index;
    const matchText = m[0];
    if (matchStart > lastIndex) {
      out.push({ kind: 'text', value: input.slice(lastIndex, matchStart) });
    }
    if (m[1]) {
      out.push({ kind: 'localhost-url', value: m[1], url: m[1] });
    } else {
      const raw = m[2] ?? m[3] ?? m[4];
      out.push(buildFileToken(raw));
    }
    lastIndex = matchStart + matchText.length;
  }
  if (lastIndex < input.length) {
    out.push({ kind: 'text', value: input.slice(lastIndex) });
  }
  return mergeAdjacentText(out);
}

function buildFileToken(raw: string): DevOutputToken {
  const { filePath, anchor } = splitFileAndAnchor(raw);
  const dot = filePath.lastIndexOf(".");
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
  return {
    kind: "file-ref",
    value: raw,
    filePath,
    anchor,
    previewable: PREVIEWABLE_FILE_EXTENSIONS.has(ext),
  };
}

function splitFileAndAnchor(raw: string): { filePath: string; anchor?: string } {
  // `#L12` first — it's unambiguous.
  const hashLine = raw.match(/^(.+?)(#L\d+)$/i);
  if (hashLine) return { filePath: hashLine[1], anchor: hashLine[2] };
  // Trailing `:12` or `:12:5` — anchored to the end so Windows drive
  // letters mid-path (C:\...) aren't mistaken for anchors.
  const colon = raw.match(/^(.+?)(:\d+(?::\d+)?)$/);
  if (colon) return { filePath: colon[1], anchor: colon[2] };
  return { filePath: raw };
}

function mergeAdjacentText(tokens: DevOutputToken[]): DevOutputToken[] {
  const out: DevOutputToken[] = [];
  for (const tok of tokens) {
    const last = out[out.length - 1];
    if (last && last.kind === "text" && tok.kind === "text") {
      last.value += tok.value;
    } else {
      out.push(tok);
    }
  }
  return out;
}
