import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Skills manager app-server wiring", () => {
  it("列表、启停、正文和卸载不再依赖失效 API", () => {
    const manager = readFileSync(resolve(process.cwd(), "src/components/skills/SkillsManager.tsx"), "utf8");
    const detail = readFileSync(resolve(process.cwd(), "src/components/skills/SkillDetailDialog.tsx"), "utf8");

    expect(manager).toContain("listSkills");
    expect(manager).toContain("setSkillEnabled");
    expect(manager).toContain('connection.data !== "connected"');
    expect(manager).toContain("readFile(skill.filePath)");
    expect(manager).toContain("removeFileTree");
    expect(manager).not.toContain('fetch(`/api/skills');
    expect(detail).toContain("<Switch");
    expect(detail).toContain("skills.tryNow");
  });

  it("系统技能使用系统分类名称", () => {
    const zh = readFileSync(resolve(process.cwd(), "src/i18n/zh.ts"), "utf8");
    const en = readFileSync(resolve(process.cwd(), "src/i18n/en.ts"), "utf8");

    expect(zh).toContain("'skills.source.sdk': '系统'");
    expect(zh).not.toContain("'skills.source.sdk': 'SDK 内置'");
    expect(en).toContain("'skills.source.sdk': 'System'");
    expect(en).not.toContain("'skills.source.sdk': 'SDK built-in'");
  });
});
