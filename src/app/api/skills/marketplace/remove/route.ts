import { NextRequest } from "next/server";

import { runSkillsCommand } from "../install/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { skillId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "移除参数无效" }, { status: 400 });
  }
  const skillId = typeof body.skillId === "string" ? body.skillId.trim() : "";
  if (!/^[a-zA-Z0-9._-]+$/.test(skillId)) return Response.json({ error: "技能标识无效" }, { status: 400 });
  return runSkillsCommand(["--yes", "skills", "remove", skillId, "--global", "--agent", "codex", "--yes"]);
}
