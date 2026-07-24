import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("关于页面精简", () => {
  it("移除支持日志和帮助链接区块", () => {
    const about = source("src/components/settings/AboutSection.tsx");

    expect(about).not.toContain("about.support.");
    expect(about).not.toContain("about.docs.");
    expect(about).not.toContain("ImportSessionDialog");
    expect(about).not.toContain("/api/doctor/export");
  });

  it("清理对应的中英文翻译键", () => {
    const english = source("src/i18n/en.ts");
    const chinese = source("src/i18n/zh.ts");

    expect(english).not.toMatch(/["']about\.(support|docs)\./);
    expect(chinese).not.toMatch(/["']about\.(support|docs)\./);
  });

  it("关于副标题只描述版本和平台信息", () => {
    const english = source("src/i18n/en.ts");
    const chinese = source("src/i18n/zh.ts");

    expect(english).toContain("'settings.aboutDesc': 'CodexWeb version and platform info'");
    expect(chinese).toContain("'settings.aboutDesc': 'CodexWeb 版本、平台信息'");
  });

  it("保留版本、运行端平台和未来更新入口作为反例", () => {
    const about = source("src/components/settings/AboutSection.tsx");

    expect(about).toContain("APP_VERSION");
    expect(about).toContain("about.platform.title");
    expect(about).toContain("useAppServerSelector");
    expect(about).toContain("state.initialize?.data.platformOs");
    expect(about).toContain("runtimePlatformLabel");
    expect(about).toContain("settings.checkForUpdates");
    expect(about).toMatch(/<Button[\s\S]*disabled[\s\S]*settings\.checkForUpdates/);
    expect(about).not.toContain("navigator.userAgent");
    expect(about).not.toContain("electronAPI");
  });
});
