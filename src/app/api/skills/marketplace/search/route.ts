import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { spawn } from "node:child_process";

import { mapSkillsShSkill, SKILLS_SH_API } from "@/lib/skills-marketplace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;
  const token = process.env.SKILLS_SH_API_TOKEN?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  if (!token) return fallbackCliSearch(query, limit, "未配置 Skills.sh API token，已使用 skills CLI");
  const url = new URL(
    query ? `${SKILLS_SH_API}/skills/search` : `${SKILLS_SH_API}/skills`,
  );
  if (query) url.searchParams.set("q", query);
  if (query) url.searchParams.set("limit", String(limit));
  else {
    url.searchParams.set("view", "trending");
    url.searchParams.set("per_page", String(limit));
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return fallbackCliSearch(query, limit);
    const payload = await response.json() as { data?: unknown; skills?: unknown };
    const entries = Array.isArray(payload.data) ? payload.data : payload.skills;
    const skills = Array.isArray(entries)
      ? entries.map((entry) => mapSkillsShSkill(entry as Record<string, unknown>)).filter(Boolean)
      : [];
    return NextResponse.json({ skills, source: query ? "skills.sh.api/v1/skills/search" : "skills.sh.api/v1/skills" });
  } catch (error) {
    return fallbackCliSearch(query, limit, error instanceof Error ? error.message : "无法连接 Skills.sh");
  }
}

function fallbackCliSearch(query: string, limit: number, upstreamError = "Skills.sh 不可用"): Promise<Response> {
  return new Promise((resolve) => {
    const cliQuery = query || "skill";
    const script = [
      process.env.CODEX_WEB_APP_ROOT && resolvePath(process.env.CODEX_WEB_APP_ROOT, "dist/skills-marketplace-search.mjs"),
      resolvePath(process.cwd(), "dist/skills-marketplace-search.mjs"),
      resolvePath(process.cwd(), "scripts/skills-marketplace-search.mjs"),
    ].find((candidate): candidate is string => Boolean(candidate && existsSync(/*turbopackIgnore: true*/ candidate)));
    if (!script) {
      resolve(NextResponse.json({ error: `${upstreamError}; 缺少 skills CLI fallback 模块` }, { status: 502 }));
      return;
    }
    const child = spawn(process.execPath, [script, cliQuery, String(limit)], {
      env: { ...process.env, DISABLE_TELEMETRY: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(NextResponse.json({ error: `${upstreamError}; skills CLI 超时` }, { status: 502 }));
    }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      let payload: { skills?: unknown[]; error?: string } = {};
      try { payload = JSON.parse(output) as typeof payload; } catch { /* 使用统一错误响应 */ }
      const skills = Array.isArray(payload.skills) ? payload.skills : [];
      resolve(skills.length > 0
        ? NextResponse.json({ skills, source: "skills.cli.find" })
        : NextResponse.json({ error: `${upstreamError}; ${payload.error || `skills CLI 退出码 ${code ?? "unknown"}`}` }, { status: 502 }));
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(NextResponse.json({ error: upstreamError }, { status: 502 }));
    });
  });
}
