const TEMP_APP_SERVER_SESSION_PREFIX = "app-server-";

export function getExistingNewChatThreadId(sessionId: string | null | undefined): string | null {
  if (!sessionId || sessionId.startsWith(TEMP_APP_SERVER_SESSION_PREFIX)) {
    return null;
  }
  return sessionId;
}
