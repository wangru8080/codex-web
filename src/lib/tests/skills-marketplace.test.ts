import { describe, expect, it } from "vitest";

import { mapSkillsShSkill, readSkillContent, skillDetailPath } from "../skills-marketplace";

describe("Skills.sh 市场适配", () => {
  it("把官方 listing 映射为市场卡片字段", () => {
    expect(mapSkillsShSkill({
      id: "vercel-labs/agent-skills/react-best-practices",
      slug: "react-best-practices",
      name: "React Best Practices",
      source: "vercel-labs/agent-skills",
      installs: 1234,
      sourceType: "github",
      installUrl: "https://github.com/vercel-labs/agent-skills",
      url: "https://skills.sh/vercel-labs/agent-skills/react-best-practices",
    })).toMatchObject({
      id: "vercel-labs/agent-skills/react-best-practices",
      package: "vercel-labs/agent-skills@react-best-practices",
      skillId: "react-best-practices",
      source: "vercel-labs/agent-skills",
      installs: 1234,
    });
  });

  it("详情只读取 SKILL.md，并对路径段编码", () => {
    expect(skillDetailPath("owner/repo/skill-name")).toBe("owner/repo/skill-name");
    expect(readSkillContent({ files: [
      { path: "README.md", contents: "readme" },
      { path: "SKILL.md", contents: "---\nname: demo\n---\nbody" },
    ] })).toContain("name: demo");
  });
});
