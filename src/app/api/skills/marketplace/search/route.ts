import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

import { mapSkillsShSkill, SKILLS_SH_API, SKILLS_SH_PUBLIC_API } from "@/lib/skills-marketplace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;
  const token = process.env.SKILLS_SH_API_TOKEN?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  const usePublicSearch = !token;
  const url = new URL(
    usePublicSearch
      ? `${SKILLS_SH_PUBLIC_API}/search`
      : query ? `${SKILLS_SH_API}/skills/search` : `${SKILLS_SH_API}/skills`,
  );
  if (usePublicSearch && !query) url.searchParams.set("q", "skill");
  if (query) url.searchParams.set("q", query);
  if (usePublicSearch || query) url.searchParams.set("limit", String(limit));
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
    return NextResponse.json({ skills, source: token ? (query ? "skills.sh.api/v1/skills/search" : "skills.sh.api/v1/skills") : "skills.sh.api/search" });
  } catch (error) {
    return fallbackCliSearch(query, limit, error instanceof Error ? error.message : "无法连接 Skills.sh");
  }
}

function fallbackCliSearch(query: string, limit: number, upstreamError = "Skills.sh 不可用"): Promise<Response> {
  if (!query) return Promise.resolve(NextResponse.json({ error: upstreamError }, { status: 502 }));
  return new Promise((resolve) => {
    const child = spawn(process.env.NPX_BIN || "npx", ["--yes", "skills", "find", query], {
      env: { ...process.env, DISABLE_TELEMETRY: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("close", (code) => {
      const skills = parseCliSearch(output, limit);
      resolve(skills.length > 0
        ? NextResponse.json({ skills, source: "skills.cli.find" })
        : NextResponse.json({ error: `${upstreamError}; skills CLI 退出码 ${code ?? "unknown"}` }, { status: 502 }));
    });
    child.on("error", () => resolve(NextResponse.json({ error: upstreamError }, { status: 502 })));
  });
}

function parseCliSearch(output: string, limit: number) {
  const lines = output.replace(/\x1B\[[0-9;]*m/g, "").split("\n");
  return lines.map((line) => line.trim().match(/^([a-zA-Z0-9_.-]+\/[^\s@]+)@([^\s]+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .slice(0, limit)
    .map((match) => ({
      id: `${match[1]}/${match[2]}`,
      package: `${match[1]}@${match[2]}`,
      skillId: match[2],
      name: match[2],
      installs: 0,
      source: match[1],
    }));
}
