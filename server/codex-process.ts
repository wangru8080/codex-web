import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type CodexProcessOptions = {
  command?: string;
  args?: string[];
  codexHome?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  inheritEnv?: boolean;
  preferControlSocket?: boolean;
};

export type CodexProcess = {
  child: ChildProcessWithoutNullStreams;
  diagnostics: string[];
  stop: () => void;
};

export function buildCodexProcessEnv(
  options: CodexProcessOptions,
  baseEnv: Record<string, string | undefined> = process.env,
): NodeJS.ProcessEnv {
  const nodeEnv = normalizeNodeEnv(options.env?.NODE_ENV ?? baseEnv.NODE_ENV);
  const env: NodeJS.ProcessEnv = {
    ...(options.inheritEnv === false ? {} : baseEnv),
    ...options.env,
    NODE_ENV: nodeEnv,
    RUST_LOG: options.env?.RUST_LOG ?? "warn",
  };
  const codexHome = options.codexHome?.trim();
  if (codexHome) {
    env.CODEX_HOME = codexHome;
  }
  return env;
}

function normalizeNodeEnv(value: string | undefined): NodeJS.ProcessEnv["NODE_ENV"] {
  return value === "development" || value === "test" || value === "production"
    ? value
    : "production";
}

export function startCodexAppServer(options: CodexProcessOptions = {}): CodexProcess {
  const diagnostics: string[] = [];
  const child = spawn(options.command ?? "codex", options.args ?? ["app-server", "--stdio"], {
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
