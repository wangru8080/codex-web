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

  it("保留版本和平台信息作为反例", () => {
    const about = source("src/components/settings/AboutSection.tsx");

    expect(about).toContain("settings.checkForUpdates");
    expect(about).toContain("about.platform.title");
  });
});
