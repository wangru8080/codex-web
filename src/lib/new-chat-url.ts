const NEW_CHAT_QUERY_KEY = "new";

export function createNewChatHref(now = Date.now()): string {
  return `/chat?${NEW_CHAT_QUERY_KEY}=${now}`;
}

export function readNewChatKey(searchParams: Pick<URLSearchParams, "get">): string {
  return searchParams.get(NEW_CHAT_QUERY_KEY) || "";
}
