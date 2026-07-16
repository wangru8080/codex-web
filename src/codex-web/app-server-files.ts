import type { FsReadDirectoryEntry } from "@/codex/protocol/generated/v2/FsReadDirectoryEntry";
import type { FsReadFileResponse } from "@/codex/protocol/generated/v2/FsReadFileResponse";
import type { FilePreview, FileTreeNode } from "@/types";

const FILE_PREVIEW_BYTE_LIMIT = 10 * 1024 * 1024;

export class AppServerFilePreviewError extends Error {
  constructor(public readonly code: "file_too_large" | "binary_not_previewable") {
    super(code);
    this.name = "AppServerFilePreviewError";
  }
}

export function directoryEntriesToNodes(
  parentPath: string,
  entries: readonly FsReadDirectoryEntry[],
): FileTreeNode[] {
  return entries
    .filter((entry) => entry.isDirectory || entry.isFile)
    .map((entry): FileTreeNode => {
      const path = joinPath(parentPath, entry.fileName);
      if (entry.isDirectory) return { name: entry.fileName, path, type: "directory" };
      const extension = fileExtension(entry.fileName);
      return {
        name: entry.fileName,
        path,
        type: "file",
        ...(extension ? { extension } : {}),
      };
    })
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
}

export function filePreviewFromResponse(
  path: string,
  response: FsReadFileResponse,
): FilePreview {
  const bytes = decodeBase64(response.dataBase64);
  if (looksBinary(bytes.subarray(0, 4096))) {
    throw new AppServerFilePreviewError("binary_not_previewable");
  }
  const content = new TextDecoder("utf-8").decode(bytes);
  const lineCount = content.length === 0 ? 0 : content.split(/\r?\n/).length;
  return {
    path,
    content,
    language: languageForPath(path),
    line_count: lineCount,
    line_count_exact: true,
    truncated: false,
    bytes_read: bytes.byteLength,
    bytes_total: bytes.byteLength,
  };
}

export function fileDataUrlFromResponse(path: string, response: FsReadFileResponse): string {
  return `data:${mediaTypeForPath(path)};base64,${response.dataBase64}`;
}

export function utf8ToBase64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(dataBase64: string): Uint8Array {
  const normalized = dataBase64.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  const decodedSize = Math.max(0, Math.floor(normalized.length * 3 / 4) - padding);
  if (decodedSize > FILE_PREVIEW_BYTE_LIMIT) {
    throw new AppServerFilePreviewError("file_too_large");
  }
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  let nonText = 0;
  for (const byte of bytes) {
    if (byte === 0) return true;
    if (byte === 9 || byte === 10 || byte === 12 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128) continue;
    nonText += 1;
  }
  return nonText / bytes.length > 0.3;
}

function joinPath(parentPath: string, fileName: string): string {
  const separator = parentPath.includes("\\") && !parentPath.includes("/") ? "\\" : "/";
  return `${parentPath.replace(/[\\/]+$/, "")}${separator}${fileName}`;
}

function fileExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function languageForPath(path: string): string {
  const extension = fileExtension(path);
  const languages: Record<string, string> = {
    md: "markdown", mdx: "markdown", ts: "typescript", tsx: "tsx",
    js: "javascript", jsx: "jsx", json: "json", py: "python", rs: "rust",
    go: "go", html: "html", htm: "html", css: "css", scss: "scss",
    yaml: "yaml", yml: "yaml", toml: "toml", sh: "bash", sql: "sql",
    csv: "csv", tsv: "tsv", xml: "xml",
  };
  return languages[extension] ?? "text";
}

function mediaTypeForPath(path: string): string {
  const extension = fileExtension(path);
  const mediaTypes: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp",
    ico: "image/x-icon", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac",
    aac: "audio/aac",
  };
  return mediaTypes[extension] ?? "application/octet-stream";
}
