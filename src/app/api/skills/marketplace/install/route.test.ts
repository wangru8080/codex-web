import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { buildInstallArgs, parseMarketplacePackage, POST, resolveGithubSkillSource } from "./route";

afterEach(() => vi.unstubAllGlobals());

describe("Skills.sh 安装参数边界", () => {
  it("拒绝不受信来源和命令片段", async () => {
    const response = await POST(new NextRequest("http://localhost/api/skills/marketplace/install", {
      method: "POST",
      body: JSON.stringify({ source: "owner/repo; touch /tmp/pwned", skillId: "demo" }),
      headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(400);
  });

  it("全局和项目安装生成不同的官方 CLI 范围参数", () => {
    expect(buildInstallArgs("owner/repo", "demo", "global")).toContain("--global");
    expect(buildInstallArgs("owner/repo", "demo", "project")).not.toContain("--global");
  });

  it("具体技能目录 URL 不再传入展示名筛选参数", () => {
    const args = buildInstallArgs(
      "https://github.com/owner/repo/tree/main/skills/real-skill",
      undefined,
      "global",
    );
    expect(args).toEqual([
      "--yes",
      "skills",
      "add",
      "https://github.com/owner/repo/tree/main/skills/real-skill",
      "--global",
      "--agent",
      "codex",
      "--yes",
    ]);
  });

  it("把 skills.sh 展示名解析为 GitHub 中的真实技能目录", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({
        tree: [
          { type: "blob", path: "skills/react-best-practices/SKILL.md" },
        ],
      }))
      .mockResolvedValueOnce(new Response("---\nname: vercel-react-best-practices\n---\n")));
    await expect(resolveGithubSkillSource("vercel-labs/agent-skills", "vercel-react-best-practices"))
      .resolves.toBe("https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices");
  });

  it("frontmatter 名称不匹配时不猜测安装目录", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({
        tree: [{ type: "blob", path: "skills/react-best-practices/SKILL.md" }],
      }))
      .mockResolvedValueOnce(new Response("---\nname: another-skill\n---\n")));
    await expect(resolveGithubSkillSource("vercel-labs/agent-skills", "vercel-react-best-practices"))
      .resolves.toBe("vercel-labs/agent-skills");
  });

  it("项目安装要求绝对 cwd", async () => {
    const response = await POST(new NextRequest("http://localhost/api/skills/marketplace/install", {
      method: "POST",
      body: JSON.stringify({ source: "owner/repo", skillId: "demo", scope: "project", cwd: "relative/path" }),
      headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(400);
  });

  it("支持 pi-web 风格的 owner/repo@skill 包名", async () => {
    expect(parseMarketplacePackage("owner/repo@demo")).toEqual({ source: "owner/repo", skillId: "demo" });
  });
});
