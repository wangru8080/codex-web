import type { FsReadFileResponse } from "@/codex/protocol/generated/v2/FsReadFileResponse";
import type { PluginInterface } from "@/codex/protocol/generated/v2/PluginInterface";
import {
  FILE_PREVIEW_BYTE_LIMIT,
  fileBytesFromResponse,
  mediaTypeForPath,
} from "@/codex-web/app-server-files";

type ReadFile = (path: string, maxBytes: number) => Promise<FsReadFileResponse>;

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

  let pending: Promise<string>;
  pending = readFile(path, FILE_PREVIEW_BYTE_LIMIT)
    .then((response) => {
      const bytes = fileBytesFromResponse(response);
      return URL.createObjectURL(new Blob([bytes], { type: mediaTypeForPath(path) }));
    })
    .catch((error) => {
      if (mediaUrlCache.get(path) === pending) mediaUrlCache.delete(path);
      throw error;
    });

  mediaUrlCache.set(path, pending);
  return pending;
}

type PluginIconSource = Pick<PluginInterface, "composerIcon" | "composerIconUrl" | "logo" | "logoUrl">;

/** 将 app-server 返回的本地图标路径转换为浏览器可显示的 URL。 */
export async function getPluginIconUrl(
  pluginInterface: PluginIconSource | null | undefined,
  readFile: ReadFile,
): Promise<string | null> {
  if (!pluginInterface) return null;

  for (const [path, url] of [
    [pluginInterface.composerIcon, pluginInterface.composerIconUrl],
    [pluginInterface.logo, pluginInterface.logoUrl],
  ] as const) {
    if (path) {
      try {
        return await getCachedMediaObjectUrl(path, readFile);
      } catch {
        // 本地插件资源不可读时继续使用 app-server 提供的远程地址。
      }
    }
    if (url) return url;
  }

  return null;
}

export function clearCachedMediaObjectUrl(path: string, readFile: ReadFile): void {
  const cache = mediaUrlCaches.get(readFile);
  if (!cache) return;
  const pending = cache.get(path);
  if (!pending) return;
  cache.delete(path);
  revokeWhenReady(pending);
}

export function clearAllCachedMediaObjectUrls(): void {
  for (const cache of mediaUrlCaches.values()) {
    for (const pending of cache.values()) revokeWhenReady(pending);
  }
  mediaUrlCaches = new Map();
}

function revokeWhenReady(pending: Promise<string>): void {
  void pending.then((url) => URL.revokeObjectURL(url), () => undefined);
}
