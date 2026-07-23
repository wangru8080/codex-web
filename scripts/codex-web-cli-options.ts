import { join } from "node:path";

export type CodexWebCliOptions = {
  host: string;
  publicHost: string;
  port: number;
  codexHome: string;
  open: boolean;
  help: boolean;
  version: boolean;
};

type CliEnvironment = Record<string, string | undefined>;

export function parseCodexWebCliArgs(
  args: string[],
  env: CliEnvironment = process.env,
  homeDirectory: string,
): CodexWebCliOptions {
  let host = env.CODEX_WEB_NEXT_HOST?.trim() || "127.0.0.1";
  let publicHost = env.CODEX_WEB_PUBLIC_HOST?.trim() || host;
  let port = parsePort(env.PORT || "3001", "PORT");
  let codexHome = env.CODEX_HOME?.trim() || join(homeDirectory, ".codex");
  let open = false;
  let help = false;
  let version = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--host": {
        host = readValue(args, ++index, "--host");
        publicHost = host;
        break;
      }
      case "--port":
        port = parsePort(readValue(args, ++index, "--port"), "--port");
        break;
      case "--codex-home":
        codexHome = readValue(args, ++index, "--codex-home");
        break;
      case "--open":
        open = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      case "--version":
      case "-v":
        version = true;
        break;
      default:
        throw new Error(`未知参数：${argument}`);
    }
  }

  return { host, publicHost, port, codexHome, open, help, version };
}

function readValue(args: string[], index: number, option: string): string {
  const value = args[index]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${option} 需要一个值`);
  return value;
}

function parsePort(value: string, source: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${source} 必须是 0 到 65535 的整数`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${source} 必须是 0 到 65535 的整数`);
  }
  return port;
}
