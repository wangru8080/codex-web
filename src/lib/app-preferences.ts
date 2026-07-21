export type AppLocalePreference = "en" | "zh";
export type DefaultPanelPreference = "none" | "file_tree" | "git";

const LOCALE_KEY = "codex-web:locale";
const DEFAULT_PANEL_KEY = "codex-web:default-panel";

export function readLocalePreference(): AppLocalePreference | null {
  const value = readPreference(LOCALE_KEY);
  return value === "en" || value === "zh" ? value : null;
}

export function writeLocalePreference(locale: AppLocalePreference): void {
  writePreference(LOCALE_KEY, locale);
}

export function readDefaultPanelPreference(): DefaultPanelPreference {
  const value = readPreference(DEFAULT_PANEL_KEY);
  return value === "none" || value === "git" || value === "file_tree"
    ? value
    : "file_tree";
}

export function writeDefaultPanelPreference(panel: DefaultPanelPreference): void {
  writePreference(DEFAULT_PANEL_KEY, panel);
}

function readPreference(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePreference(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 浏览器禁用本地存储时保留当前会话内状态。
  }
}
