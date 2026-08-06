import type { FsReadFileResponse } from "@/codex/protocol/generated/v2/FsReadFileResponse";
import { fileBytesFromResponse, mediaTypeForPath } from "@/codex-web/app-server-files";

type ReadFile = (path: string) => Promise<FsReadFileResponse>;

let mediaUrlCaches = new Map<ReadFile, Map<string, Promise<string>>>();

/** 按路径复用 app-server 文件读取和浏览器 Blob URL，避免同一大图重复传输。 */
export function getCachedMediaObjectUrl(path: string, readFile: ReadFile): Promise<string> {
  let mediaUrlCache = mediaUrlCaches.get(readFile);
  if (!mediaUrlCache) {
    mediaUrlCache = new Map();
    mediaUrlCaches.set(readFile, mediaUrlCache);
  }
  const cached = mediaUrlCache.get(path);
  if (cached) return cached;

  const pending = readFile(path)
    .then((response) => {
      const bytes = fileBytesFromResponse(response);
      return URL.createObjectURL(new Blob([bytes], { type: mediaTypeForPath(path) }));
    })
    .catch((error) => {
      mediaUrlCache.delete(path);
      throw error;
    });

  mediaUrlCache.set(path, pending);
  return pending;
}

export function clearCachedMediaObjectUrl(path: string, readFile: ReadFile): void {
  mediaUrlCaches.get(readFile)?.delete(path);
}

export function clearAllCachedMediaObjectUrls(): void {
  mediaUrlCaches = new Map();
}
