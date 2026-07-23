import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export const isolatedCodexHome = "/volume2/SSD/codex/Temp/codex-dev-home";

export type CodexProcessOptions = {
  command?: string;
  codexHome?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type CodexProcess = {
  child: ChildProcessWithoutNullStreams;
  diagnostics: string[];
  stop: () => void;
};

export function buildCodexProcessEnv(
  options: CodexProcessOptions,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    ...options.env,
    RUST_LOG: options.env?.RUST_LOG ?? "warn",
  };
  const codexHome = options.codexHome?.trim();
  if (codexHome) {
    env.CODEX_HOME = codexHome;
  }
  return env;
}

export function startCodexAppServer(options: CodexProcessOptions = {}): CodexProcess {
  const diagnostics: string[] = [];
  const child = spawn(options.command ?? "codex", ["app-server", "--stdio"], {
    cwd: options.cwd,
    env: buildCodexProcessEnv(options),
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    diagnostics.push(...splitDiagnostics(chunk));
    if (diagnostics.length > 50) {
      diagnostics.splice(0, diagnostics.length - 50);
    }
  });

  return {
    child,
    diagnostics,
    stop: () => {
      if (!child.killed) {
        child.kill();
      }
    },
  };
}

function splitDiagnostics(chunk: string): string[] {
  return chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
