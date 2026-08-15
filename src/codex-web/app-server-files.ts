import type { FsReadDirectoryEntry } from "@/codex/protocol/generated/v2/FsReadDirectoryEntry";
import type { FsReadFileResponse } from "@/codex/protocol/generated/v2/FsReadFileResponse";
import type { CommandExecParams } from "@/codex/protocol/generated/v2/CommandExecParams";
import type { CommandExecResponse } from "@/codex/protocol/generated/v2/CommandExecResponse";
import type { FilePreview, FileTreeNode } from "@/types";

export const FILE_PREVIEW_BYTE_LIMIT = 10 * 1024 * 1024;

const WINDOWS_FILE_SIZE_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$stream=[IO.File]::OpenRead($env:CODEX_WEB_FILE_PATH)",
  "try{[Console]::Out.Write($stream.Length)}finally{$stream.Dispose()}",
].join(";");

export class AppServerFilePreviewError extends Error {
  constructor(public readonly code: "file_too_large" | "binary_not_previewable") {
    super(code);
    this.name = "AppServerFilePreviewError";
  }
}

export function buildFileSizeCommand(platformFamily: string, path: string): CommandExecParams {
  const isWindows = platformFamily.toLowerCase() === "windows";
  return {
    command: isWindows
      ? ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_FILE_SIZE_SCRIPT]
      : ["wc", "-c", path],
    ...(isWindows ? { env: { CODEX_WEB_FILE_PATH: path } } : {}),
    outputBytesCap: 128,
    timeoutMs: 10_000,
    sandboxPolicy: { type: "dangerFullAccess" },
  };
}

export function limitedFileResponse(
  response: FsReadFileResponse,
  maxBytes: number,
): FsReadFileResponse {
  assertByteLimit(maxBytes);
  if (decodedBase64Size(response.dataBase64) > maxBytes) {
    throw new AppServerFilePreviewError("file_too_large");
  }
  return response;
}

export function fileSizeFromCommandResponse(response: CommandExecResponse): number {
  assertCommandSucceeded(response);
  const size = Number(/^\s*(\d+)(?:\s|$)/.exec(response.stdout)?.[1]);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("app-server 返回了无效的文件大小");
  }
  return size;
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

export function directoryContainsName(
  parentPath: string,
  entries: readonly FsReadDirectoryEntry[],
  fileName: string,
): boolean {
  const caseInsensitive = parentPath.includes("\\") && !parentPath.includes("/");
  const expected = caseInsensitive ? fileName.toLowerCase() : fileName;
  return entries.some((entry) => (
    caseInsensitive ? entry.fileName.toLowerCase() : entry.fileName
  ) === expected);
}

export function filePreviewFromResponse(
  path: string,
  response: FsReadFileResponse,
): FilePreview {
  if (decodedBase64Size(response.dataBase64) > FILE_PREVIEW_BYTE_LIMIT) {
    throw new AppServerFilePreviewError("file_too_large");
  }
  const bytes = fileBytesFromResponse(response);
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

export function fileBytesFromResponse(response: FsReadFileResponse): Uint8Array<ArrayBuffer> {
  const normalized = response.dataBase64.replace(/\s/g, "");
  const binary = atob(normalized);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function fileDocumentBytesFromResponse(response: FsReadFileResponse): Uint8Array<ArrayBuffer> {
  if (decodedBase64Size(response.dataBase64) > FILE_PREVIEW_BYTE_LIMIT) {
    throw new AppServerFilePreviewError("file_too_large");
  }
  return fileBytesFromResponse(response);
}

export function utf8ToBase64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function utf8FromBase64(dataBase64: string): string {
  return new TextDecoder("utf-8").decode(fileBytesFromResponse({ dataBase64 }));
}

function decodedBase64Size(dataBase64: string): number {
  const normalized = dataBase64.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(normalized.length * 3 / 4) - padding);
}

function assertByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes >= Number.MAX_SAFE_INTEGER) {
    throw new Error("文件读取上限无效");
  }
}

function assertCommandSucceeded(response: CommandExecResponse): void {
  if (response.exitCode === 0) return;
  throw new Error(response.stderr.trim() || `文件命令执行失败（退出码 ${response.exitCode}）`);
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

export function languageForPath(path: string): string {
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const names: Record<string, string> = {
    dockerfile: "dockerfile",
    makefile: "makefile",
    "cmakelists.txt": "makefile",
  };
  if (names[fileName]) return names[fileName];

  const extension = fileExtension(path);
  const languages: Record<string, string> = {
    md: "markdown", mdx: "markdown", ts: "typescript", tsx: "tsx",
    js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
    json: "json", jsonc: "json", py: "python", pyw: "python", rs: "rust",
    go: "go", html: "html", htm: "html", css: "css", scss: "scss",
    yaml: "yaml", yml: "yaml", toml: "toml", sh: "bash", bash: "bash",
    zsh: "bash", fish: "bash", sql: "sql", xml: "xml", svg: "xml",
    c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp",
    cs: "csharp", java: "java", kt: "kotlin", kts: "kotlin",
    rb: "ruby", php: "php", swift: "swift", lua: "lua", pl: "perl",
    pm: "perl", ps1: "powershell", psm1: "powershell", diff: "diff",
    patch: "diff", ini: "ini", cfg: "ini", conf: "ini",
  };
  return languages[extension] ?? "plaintext";
}

export function mediaTypeForPath(path: string): string {
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
