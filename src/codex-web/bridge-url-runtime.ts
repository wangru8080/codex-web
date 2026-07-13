export type BridgeUrlFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export async function resolveCodexBridgeUrl(
  publicBridgeUrl: string,
  fetcher: BridgeUrlFetch = fetch,
): Promise<string> {
  if (publicBridgeUrl.trim()) {
    return publicBridgeUrl;
  }

  const response = await fetcher("/api/codex/bridge-url", {
    cache: "no-store",
  });
  const body = (await response.json()) as { bridgeUrl?: unknown; error?: unknown };

  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `bridge url request failed: ${response.status}`);
  }

  if (typeof body.bridgeUrl !== "string" || body.bridgeUrl.length === 0) {
    throw new Error("CODEX_WEB_BRIDGE_URL 未设置");
  }

  return body.bridgeUrl;
}
