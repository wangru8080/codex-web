import { NextRequest, NextResponse } from "next/server";

import { readSkillContent, skillDetailPath, SKILLS_SH_API } from "@/lib/skills-marketplace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("source")?.trim() ?? "";
  const skillId = request.nextUrl.searchParams.get("skillId")?.trim() ?? "";
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(source) || !/^[a-zA-Z0-9._-]+$/.test(skillId)) {
    return NextResponse.json({ error: "技能标识无效" }, { status: 400 });
  }

  try {
    const token = process.env.SKILLS_SH_API_TOKEN?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
    if (!token) {
      const content = await readGithubSkill(source, skillId);
      return NextResponse.json({ content, source: "github.raw.SKILL.md" });
    }
    const response = await fetch(`${SKILLS_SH_API}/skills/${skillDetailPath(`${source}/${skillId}`)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return NextResponse.json({ error: `Skills.sh 返回 ${response.status}` }, { status: 502 });
    const content = readSkillContent(await response.json());
    return NextResponse.json({ content, source: "skills.sh.api/v1/skills/detail" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法读取技能详情" },
      { status: 502 },
    );
  }
}

async function readGithubSkill(source: string, skillId: string): Promise<string | null> {
  const directoryNames = [...new Set([skillId, skillId.replace(/^[^-]+-/, "")])];
  for (const branch of ["main", "master"]) {
    for (const directoryName of directoryNames) {
      for (const path of [`skills/${directoryName}/SKILL.md`, `${directoryName}/SKILL.md`]) {
        try {
          const response = await fetch(`https://raw.githubusercontent.com/${source}/${branch}/${path}`, {
            signal: AbortSignal.timeout(5_000),
          });
          if (response.ok) return response.text();
        } catch {
          // 继续尝试其它分支和目录布局。
        }
      }
    }

    let treeResponse: Response;
    try {
      treeResponse = await fetch(`https://api.github.com/repos/${source}/git/trees/${branch}?recursive=1`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "codex-web-skills-marketplace" },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      continue;
    }
    if (!treeResponse.ok) continue;
    const tree = await treeResponse.json() as { tree?: Array<{ path?: unknown; type?: unknown }> };
    const normalizedSkillId = skillId.toLowerCase().replace(/^vercel-/, "");
    const skillPath = tree.tree?.find((entry) => {
      if (entry.type !== "blob" || typeof entry.path !== "string" || !/skill\.md$/i.test(entry.path)) return false;
      const directory = entry.path.split("/").at(-2)?.toLowerCase() ?? "";
      return directory === skillId.toLowerCase() || directory === normalizedSkillId;
    })?.path;
    if (typeof skillPath === "string") {
      try {
        const response = await fetch(`https://raw.githubusercontent.com/${source}/${branch}/${skillPath}`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) return response.text();
      } catch {
        // 远程原始文件不可达时返回空内容，由 UI 显示无详情状态。
      }
    }
  }
  return null;
}
