import type { ScreenShareConfig } from "./types";

export type ScreenShareConfigOptions = {
  enabled?: boolean;
  display?: string;
  x11vncPath?: string;
  wsPath?: string;
  isBrokerMode?: boolean;
};

export function resolveScreenShareConfig(
  options: ScreenShareConfigOptions = {},
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): ScreenShareConfig {
  const isBroker = options.isBrokerMode ?? Boolean(env.CODEX_WEB_RUNTIME_BROKER_SOCKET?.trim());
  if (isBroker) {
    return {
      enabled: false,
      wsPath: options.wsPath ?? "/screen-share/ws",
    };
  }

  const envEnabled = env.CODEX_WEB_SCREEN_SHARE?.trim();
  const isEnvEnabled = envEnabled === "1" || envEnabled === "true" || envEnabled === "yes";
  const enabled = options.enabled ?? isEnvEnabled;

  const display = options.display ?? env.CODEX_WEB_SCREEN_SHARE_DISPLAY?.trim() ?? env.DISPLAY?.trim();
  const x11vncPath = options.x11vncPath ?? env.CODEX_WEB_X11VNC_PATH?.trim();

  return {
    enabled,
    display: display || undefined,
    x11vncPath: x11vncPath || undefined,
    wsPath: options.wsPath ?? "/screen-share/ws",
  };
}
