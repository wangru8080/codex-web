import type { ConnectionStatus } from "./app-server-state";
import { readLocalePreference } from "@/lib/app-preferences";

export type AppServerConnectionNotice = {
  message: string;
  description?: string;
  actions?: Array<{
    label: string;
    onClick: () => void;
    variant?: "default" | "outline" | "ghost";
  }>;
};

export function appServerConnectionNotice(
  status: ConnectionStatus,
  reconnect: () => void,
  locale?: string,
): AppServerConnectionNotice | null {
  const isEnglish = locale === "en" || (locale === undefined && readLocalePreference() === "en");
  if (status === "failed") {
    return {
      message: isEnglish ? "Connection to Codex app-server failed." : "与 Codex app-server 的连接失败。",
      description: isEnglish ? "Please check network or service status and try again." : "请检查网络或服务状态后重试。",
      actions: [{ label: isEnglish ? "Reconnect" : "重新连接", onClick: reconnect }],
    };
  }
  if (status === "reconnecting") {
    return {
      message: isEnglish
        ? "Connection to Codex app-server disconnected. Reconnecting..."
        : "与 Codex app-server 的连接已断开，正在重新连接...",
    };
  }
  return null;
}
