/**
 * Settings 导航配置是桌面侧栏和移动端横向 tab 的唯一来源。
 * Codex 专用 Web 版只暴露 Codex 账户/Runtime 与少量通用设置；
 * provider/model/runtime/health/usage/bridge 等旧产品页保留为重定向壳。
 */

import type { CodexWebIconName } from "@/components/ui/semantic-icon";
import type { TranslationKey } from "@/i18n";

export type SettingsSection =
  | "codex"
  | "general"
  | "security"
  | "appearance"
  | "archived"
  | "about";

export interface SettingsNavItem {
  id: SettingsSection;
  /** 稳定英文标签；实际展示文案由 i18nKey 映射。 */
  label: string;
  /** 语义图标别名，由 CodexWebIcon 解析为具体图标。 */
  icon: CodexWebIconName;
  href: string;
  i18nKey: TranslationKey;
  groupI18nKey?: TranslationKey;
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { id: "codex", label: "Codex", icon: "runtime", href: "/settings/codex", i18nKey: "settings.codex" as TranslationKey },
  { id: "general", label: "General", icon: "settings", href: "/settings/general", i18nKey: "settings.general" as TranslationKey },
  { id: "security", label: "Security", icon: "settings", href: "/settings/security", i18nKey: "settings.security" as TranslationKey },
  { id: "appearance", label: "Appearance", icon: "appearance", href: "/settings/appearance", i18nKey: "settings.appearance" as TranslationKey },
  { id: "about", label: "About", icon: "about", href: "/settings/about", i18nKey: "settings.about" as TranslationKey },
  {
    id: "archived",
    label: "Archived Tasks",
    icon: "archive",
    href: "/settings/archived",
    i18nKey: "settings.archivedTasks" as TranslationKey,
    groupI18nKey: "settings.archivedGroup" as TranslationKey,
  },
];

export function pathnameToSettingsSection(pathname: string): SettingsSection {
  if (pathname === "/settings") return "codex";
  const tail = pathname.replace(/^\/settings\/?/, "").split("/")[0];
  if (SETTINGS_NAV_ITEMS.some((item) => item.id === tail)) return tail as SettingsSection;
  return "codex";
}
