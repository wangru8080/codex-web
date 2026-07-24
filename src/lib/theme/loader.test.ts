import { describe, expect, it } from "vitest";

import { _resetCache, getAllThemeFamilies, resolveThemesDir } from "./loader";

describe("resolveThemesDir", () => {
  it("使用应用根目录而不是用户工作目录", () => {
    const themesDir = resolveThemesDir({
      applicationRoot: "/opt/codex-web/app",
      workingDirectory: "/home/user/project",
    });

    expect(themesDir).toBe("/opt/codex-web/app/themes");
  });

  it("开发入口未提供应用根目录时回退到启动目录", () => {
    const themesDir = resolveThemesDir({
      applicationRoot: "",
      workingDirectory: "/home/user/codex-web-source",
    });

    expect(themesDir).toBe("/home/user/codex-web-source/themes");
  });
});

describe("getAllThemeFamilies", () => {
  it("加载仓库中的全部主题并保持稳定排序", () => {
    _resetCache();
    const families = getAllThemeFamilies();
    const ids = families.map((family) => family.id);
    const orders = families.map((family) => family.order);

    expect(families).toHaveLength(12);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("default");
    expect(orders).toEqual([...orders].sort((left, right) => left - right));
  });
});
