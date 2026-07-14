export type BridgeUrlFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export type BridgePageLocation = Pick<Location, "protocol" | "host">;

type BridgeRuntimeResponse = {
  bridgeUrl?: unknown;
  homeDirectory?: unknown;
  error?: unknown;
};

export async function resolveCodexBridgeUrl(
  publicBridgeUrl: string,
  fetcher: BridgeUrlFetch = fetch,
  location?: BridgePageLocation,
): Promise<string> {
  if (publicBridgeUrl.trim()) {
    return resolveBridgeEndpoint(publicBridgeUrl, location);
  }

  const response = await fetcher("/api/codex/bridge-url", {
    cache: "no-store",
  });
  const body = (await response.json()) as BridgeRuntimeResponse;

  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `bridge url request failed: ${response.status}`);
  }

  if (typeof body.bridgeUrl !== "string" || body.bridgeUrl.length === 0) {
    throw new Error("CODEX_WEB_BRIDGE_URL 未设置");
  }

  return resolveBridgeEndpoint(body.bridgeUrl, location);
}

export async function resolveCodexBridgeHomeDirectory(
  fetcher: BridgeUrlFetch = fetch,
): Promise<string> {
  const response = await fetcher("/api/codex/bridge-url", {
    cache: "no-store",
  });
  const body = (await response.json()) as BridgeRuntimeResponse;
  if (typeof body.homeDirectory !== "string" || body.homeDirectory.trim().length === 0) {
    throw new Error("CODEX_WEB_HOME_DIRECTORY 主目录未设置");
  }
  return body.homeDirectory.trim();
}

export function resolveBridgeEndpoint(
  endpoint: string,
  location?: BridgePageLocation,
): string {
  if (/^wss?:\/\//i.test(endpoint)) return endpoint;
  if (!endpoint.startsWith("/")) {
    throw new Error(`bridge URL 必须是 ws/wss URL 或同源绝对路径：${endpoint}`);
  }
  const pageLocation = location ?? readBrowserLocation();
  const protocol = pageLocation.protocol === "https:"
    ? "wss:"
    : pageLocation.protocol === "http:"
      ? "ws:"
      : null;
  if (!protocol) throw new Error(`页面协议不支持 WebSocket：${pageLocation.protocol}`);
  return `${protocol}//${pageLocation.host}${endpoint}`;
}

function readBrowserLocation(): BridgePageLocation {
  if (typeof window === "undefined") {
    throw new Error("同源 bridge path 只能在浏览器中解析");
  }
  return window.location;
}
