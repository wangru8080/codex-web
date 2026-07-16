export interface FileExcerptReference {
  id: string;
  path: string;
  name: string;
  text: string;
  startLine?: number;
  endLine?: number;
}

export type FileExcerptDisplayReference = Omit<FileExcerptReference, "text">;

export interface FileExcerptParseResult<T> {
  references: T[];
  request: string;
}

const PROMPT_START = "[CODEX_WEB_FILE_EXCERPTS_V1]";
const PROMPT_END = "[/CODEX_WEB_FILE_EXCERPTS_V1]";
const DISPLAY_PREFIX = "<!--file-excerpts:";
const DISPLAY_SUFFIX = "-->";

export function locateExcerptLines(
  source: string,
  selectedText: string,
  lineOffset = 0,
): { startLine: number; endLine: number } | null {
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  const normalizedSelection = selectedText.replace(/\r\n?/g, "\n");
  if (!normalizedSelection) return null;

  const first = normalizedSource.indexOf(normalizedSelection);
  if (first >= 0) {
    if (normalizedSource.indexOf(normalizedSelection, first + 1) >= 0) return null;
    const startLine = lineOffset + normalizedSource.slice(0, first).split("\n").length;
    const endLine = startLine + normalizedSelection.split("\n").length - 1;
    return { startLine, endLine };
  }

  const searchable = markdownSourceSearchText(normalizedSource);
  const needle = collapseWhitespace(normalizedSelection);
  if (!needle) return null;
  const matches: Array<{ startLine: number; endLine: number }> = [];
  let cursor = 0;
  while (cursor <= searchable.text.length - needle.length) {
    const index = searchable.text.indexOf(needle, cursor);
    if (index < 0) break;
    matches.push({
      startLine: lineOffset + searchable.lineByIndex[index],
      endLine: lineOffset + searchable.lineByIndex[index + needle.length - 1],
    });
    if (matches.length > 1) return null;
    cursor = index + 1;
  }
  return matches[0] ?? null;
}

function markdownSourceSearchText(source: string): { text: string; lineByIndex: number[] } {
  let text = "";
  const lineByIndex: number[] = [];
  const append = (value: string, line: number) => {
    for (const character of value) {
      if (/\s/.test(character)) {
        if (text && !text.endsWith(" ")) {
          text += " ";
          lineByIndex.push(line);
        }
      } else {
        text += character;
        lineByIndex.push(line);
      }
    }
  };

  source.split("\n").forEach((line, index) => {
    if (/^\s*```/.test(line)) return;
    const withoutQuote = line.replace(/^\s*(?:>\s*)+/, "");
    const withoutBlockMarker = withoutQuote.replace(
      /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/,
      "",
    );
    const renderedLine = withoutBlockMarker
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[~*]/g, "")
      .replace(/\\([\\`*_[\]{}()#+.!-])/g, "$1");
    append(renderedLine, index + 1);
    append(" ", index + 1);
  });

  return { text: text.trimEnd(), lineByIndex };
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function buildFileExcerptPrompt(
  request: string,
  references: readonly FileExcerptReference[],
): string {
  if (references.length === 0) return request;
  return `${PROMPT_START}\n${JSON.stringify(references, null, 2)}\n${PROMPT_END}\n\n${request}`;
}

export function encodeFileExcerptDisplay(
  request: string,
  references: readonly FileExcerptReference[],
): string {
  if (references.length === 0) return request;
  const metadata: FileExcerptDisplayReference[] = references.map(({ text: _text, ...reference }) => reference);
  return `${DISPLAY_PREFIX}${encodeURIComponent(JSON.stringify(metadata))}${DISPLAY_SUFFIX}${request}`;
}

export function parseFileExcerptDisplay(
  content: string,
): FileExcerptParseResult<FileExcerptDisplayReference> {
  if (!content.startsWith(DISPLAY_PREFIX)) return { references: [], request: content };
  const markerEnd = content.indexOf(DISPLAY_SUFFIX, DISPLAY_PREFIX.length);
  if (markerEnd < 0) return { references: [], request: content };

  try {
    const encoded = content.slice(DISPLAY_PREFIX.length, markerEnd);
    const references = JSON.parse(decodeURIComponent(encoded));
    if (!isDisplayReferences(references)) return { references: [], request: content };
    return {
      references,
      request: content.slice(markerEnd + DISPLAY_SUFFIX.length),
    };
  } catch {
    return { references: [], request: content };
  }
}

export function parseFileExcerptPrompt(
  content: string,
): FileExcerptParseResult<FileExcerptReference> {
  if (!content.startsWith(`${PROMPT_START}\n`)) return { references: [], request: content };
  const jsonStart = PROMPT_START.length + 1;
  const marker = `\n${PROMPT_END}`;
  const jsonEnd = content.indexOf(marker, jsonStart);
  if (jsonEnd < 0) return { references: [], request: content };

  try {
    const references = JSON.parse(content.slice(jsonStart, jsonEnd));
    if (!isPromptReferences(references)) return { references: [], request: content };
    const requestStart = jsonEnd + marker.length;
    return {
      references,
      request: content.slice(requestStart).replace(/^\r?\n\r?\n/, ""),
    };
  } catch {
    return { references: [], request: content };
  }
}

function isDisplayReferences(value: unknown): value is FileExcerptDisplayReference[] {
  return Array.isArray(value) && value.every((reference) => {
    if (!reference || typeof reference !== "object") return false;
    const candidate = reference as Partial<FileExcerptDisplayReference>;
    return typeof candidate.id === "string"
      && typeof candidate.path === "string"
      && typeof candidate.name === "string"
      && optionalPositiveInteger(candidate.startLine)
      && optionalPositiveInteger(candidate.endLine);
  });
}

function isPromptReferences(value: unknown): value is FileExcerptReference[] {
  return isDisplayReferences(value) && value.every((reference) => {
    return typeof (reference as Partial<FileExcerptReference>).text === "string";
  });
}

function optionalPositiveInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && Number(value) > 0);
}
