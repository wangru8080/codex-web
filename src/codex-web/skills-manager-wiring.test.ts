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
});
