import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path, { resolve as resolvePath } from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: { source?: unknown; skillId?: unknown; package?: unknown; scope?: unknown; cwd?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "安装参数无效" }, { status: 400 });
  }
  const packageName = typeof body.package === "string" ? body.package.trim() : "";
  const parsedPackage = parseMarketplacePackage(packageName);
  const source = typeof body.source === "string" ? body.source.trim() : parsedPackage?.source ?? "";
  const skillId = typeof body.skillId === "string" ? body.skillId.trim() : parsedPackage?.skillId ?? "";
  const scope = body.scope === "project" ? "project" : body.scope === "global" ? "global" : "";
  const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  const projectCwd = scope === "project" ? (cwd || process.cwd()) : undefined;
  if (!validSource(source) || !/^[a-zA-Z0-9._-]+$/.test(skillId) || !scope || (scope === "project" && !validProjectCwd(projectCwd ?? ""))) {
    return Response.json({ error: "技能来源或标识无效" }, { status: 400 });
  }

  const resolvedSource = await resolveGithubSkillSource(source, skillId);
  return runSkillsCommand(
    buildInstallArgs(resolvedSource, resolvedSource === source ? skillId : undefined, scope),
    projectCwd,
  );
}

export function parseMarketplacePackage(value: string): { source: string; skillId: string } | null {
  const match = value.match(/^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)@([a-zA-Z0-9._-]+)$/);
  return match ? { source: match[1], skillId: match[2] } : null;
}

export function buildInstallArgs(source: string, skillId: string | undefined, scope: "global" | "project"): string[] {
  return [
    "--yes",
    "skills",
    "add",
    source,
    ...(skillId ? ["--skill", skillId] : []),
    ...(scope === "global" ? ["--global"] : []),
    "--agent",
    "codex",
    "--yes",
  ];
}

export async function resolveGithubSkillSource(source: string, skillId: string): Promise<string> {
  const repository = source.match(/^(?:https:\/\/github\.com\/)?([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?$/);
  if (!repository) return source;

  const normalizedSkillId = skillId.replace(/^[^-]+-/, "");
  for (const branch of ["main", "master"]) {
    try {
      const response = await fetch(`https://api.github.com/repos/${repository[1]}/${repository[2]}/git/trees/${branch}?recursive=1`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "codex-web-skills-marketplace" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) continue;
      const payload = await response.json() as { tree?: Array<{ path?: unknown; type?: unknown }> };
      const skillFiles = payload.tree?.filter((entry) =>
        entry.type === "blob" && typeof entry.path === "string" && /\/SKILL\.md$/i.test(entry.path),
      ) ?? [];
      const directoryName = (entry: { path?: unknown }) => typeof entry.path === "string" ? entry.path.split("/").at(-2)?.toLowerCase() : undefined;
      const exactSkillFile = skillFiles.find((entry) => directoryName(entry) === skillId.toLowerCase());
      const normalizedSkillFile = skillFiles.find((entry) => directoryName(entry) === normalizedSkillId.toLowerCase());
      const skillFile = exactSkillFile ?? (normalizedSkillFile && typeof normalizedSkillFile.path === "string" && await skillFrontmatterMatches(
        repository[1], repository[2], branch, normalizedSkillFile.path, skillId,
      ) ? normalizedSkillFile : undefined);
      if (typeof skillFile?.path !== "string") continue;
      const directoryPath = skillFile.path.split("/").slice(0, -1).map(encodeURIComponent).join("/");
      return `https://github.com/${repository[1]}/${repository[2]}/tree/${branch}/${directoryPath}`;
    } catch {
      // 解析失败时保留原始来源，让 CLI 自己处理其它来源格式。
    }
  }
  return source;
}

async function skillFrontmatterMatches(owner: string, repo: string, branch: string, skillFilePath: string | undefined, skillId: string): Promise<boolean> {
  if (!skillFilePath) return false;
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skillFilePath}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const frontmatter = (await response.text()).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? "";
    const name = frontmatter.match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1]?.trim();
    return name === skillId;
  } catch {
    return false;
  }
}

function validProjectCwd(cwd: string): boolean {
  return Boolean(cwd) && path.isAbsolute(cwd) && !cwd.includes("\0") && existsSync(cwd);
}

function validSource(source: string): boolean {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(source) || /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/?$/.test(source);
}

export function runSkillsCommand(args: string[], cwd?: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const script = [
        process.env.CODEX_WEB_APP_ROOT && resolvePath(process.env.CODEX_WEB_APP_ROOT, "dist/skills-cli.mjs"),
        resolvePath(process.cwd(), "dist/skills-cli.mjs"),
        resolvePath(process.cwd(), "scripts/skills-cli.mjs"),
      ].find((candidate): candidate is string => Boolean(candidate && existsSync(/*turbopackIgnore: true*/ candidate)));
      if (!script) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify("缺少 skills CLI 模块")}\n\n`));
        controller.close();
        return;
      }
      const child = spawn(process.execPath, [script, ...args], {
        env: { ...process.env, SKILLS_CLI_CWD: cwd || "" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const write = (event: string, data: string) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      child.stdout.on("data", (chunk: Buffer) => write("output", chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => write("output", chunk.toString()));
      child.on("error", (error) => { write("error", error.message); controller.close(); });
      child.on("close", (code) => {
        if (code === 0) write("done", "ok");
        else write("error", `skills 命令退出码 ${code ?? "unknown"}`);
        controller.close();
      });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
