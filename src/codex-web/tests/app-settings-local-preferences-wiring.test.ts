import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Web 本地偏好接线", () => {
  it("语言和默认面板使用本地偏好模块", () => {
    const i18n = read("src/components/layout/I18nProvider.tsx");
    const general = read("src/components/settings/GeneralSection.tsx");
    const history = read("src/app/chat/[id]/page.tsx");

    expect(i18n).toContain("readLocalePreference");
    expect(i18n).toContain("writeLocalePreference");
    expect(general).toContain("readDefaultPanelPreference");
    expect(general).toContain("writeDefaultPanelPreference");
    expect(history).toContain("readDefaultPanelPreference");
  });

  it("主题只使用现有 Provider 的本地持久化", () => {
    const appearance = read("src/components/settings/AppearanceSection.tsx");
    const themeProvider = read("src/components/layout/ThemeProvider.tsx");
    const familyProvider = read("src/components/layout/ThemeFamilyProvider.tsx");

    expect(appearance).not.toContain("persistThemeSetting");
    expect(themeProvider).toContain("NextThemesProvider");
    expect(familyProvider).toContain("localStorage.setItem");
  });

  it("生产调用方与 preview mock 均不再引用旧接口", () => {
    for (const path of [
      "src/components/layout/I18nProvider.tsx",
      "src/components/settings/GeneralSection.tsx",
      "src/components/settings/AppearanceSection.tsx",
      "src/app/chat/[id]/page.tsx",
      "src/frontend-preview/mock-api.ts",
    ]) {
      expect(read(path), path).not.toContain("/api/settings/app");
    }
  });
});
