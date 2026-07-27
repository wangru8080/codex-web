import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Skill try tag wiring", () => {
  it("详情导航、输入框 tag 和 app-server structured input 保留 path", () => {
    const manager = readFileSync(resolve(process.cwd(), "src/components/skills/SkillsManager.tsx"), "utf8");
    const input = readFileSync(resolve(process.cwd(), "src/components/chat/MessageInput.tsx"), "utf8");
    const page = readFileSync(resolve(process.cwd(), "src/app/chat/page.tsx"), "utf8");
    const turnInput = readFileSync(resolve(process.cwd(), "src/codex-web/turn-input.ts"), "utf8");

    expect(manager).toContain("skillPath: skill.filePath");
    expect(page).toContain("initialSkill={effectiveInitialSkill}");
    expect(page).toContain("setConsumedSkillKey");
    expect(input).toContain("skillPath: initialSkill.path");
    expect(input).toContain("path: b.skillPath");
    expect(turnInput).toContain('type: "skill"');
  });
});
