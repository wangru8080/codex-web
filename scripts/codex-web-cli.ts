import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCodexWebCliArgs } from "./codex-web-cli-options";

const applicationRoot = fileURLToPath(new URL("../../", import.meta.url));

async function main(): Promise<void> {
  const options = parseCodexWebCliArgs(process.argv.slice(2), process.env, homedir());

  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }
  if (options.version) {
    console.log(await readPackageVersion());
    return;
  }
  if (options.open && options.port === 0) {
    throw new Error("--open 不能与 --port 0 同时使用，请指定固定端口");
  }

  process.env.CODEX_HOME = options.codexHome;
  process.env.CODEX_WEB_APP_ROOT = applicationRoot;
  process.env.CODEX_WEB_NEXT_HOST = options.host;
  process.env.CODEX_WEB_PUBLIC_HOST = options.publicHost;
  process.env.PORT = String(options.port);

  await import("./start-next-with-bridge");

  if (options.open) openBrowser(`http://${options.publicHost}:${options.port}`);
}

async function readPackageVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(applicationRoot, "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string") throw new Error("package.json 缺少有效版本号");
  return packageJson.version;
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin"
    ? { executable: "open", args: [url] }
    : process.platform === "win32"
      ? { executable: "cmd", args: ["/c", "start", "", url] }
      : { executable: "xdg-open", args: [url] };
  const child = spawn(command.executable, command.args, { detached: true, stdio: "ignore" });
  child.once("error", (error) => console.error(`无法自动打开浏览器：${error.message}`));
  child.unref();
}

const HELP_TEXT = `Codex Web CLI

用法：
  codex-web [选项]

选项：
  --host <地址>         监听地址，默认 127.0.0.1
  --port <端口>         HTTP 端口，默认 3001；0 表示随机端口
  --codex-home <路径>   Codex 配置与会话目录，默认 CODEX_HOME 或 ~/.codex
  --open                启动后打开默认浏览器，不能与 --port 0 同时使用
  -h, --help            显示帮助
  -v, --version         显示版本

必需环境变量：
  CODEX_WEB_LOGIN_EMAIL
  CODEX_WEB_LOGIN_PASSWORD
  CODEX_WEB_SESSION_SECRET`;

void main().catch((error) => {
  console.error(`Codex Web CLI 启动失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
