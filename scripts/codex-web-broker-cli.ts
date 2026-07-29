import { stdin } from "node:process";

import { APP_VERSION } from "../src/lib/app-version";
import {
  createBrokerRuntimeFactory,
  resolveBrokerRuntimeUsers,
  resolveRuntimeBrokerPlatform,
} from "../server/runtime-broker-launch";
import { hashBrokerPassword } from "../server/runtime-broker-password";
import { readRuntimeBrokerConfig } from "../server/runtime-broker-config";
import { createRuntimeBrokerServer } from "../server/runtime-broker-server";
import { parseCodexWebBrokerArgs } from "./codex-web-broker-options";

export async function runCodexWebRuntimeCli(args: string[]): Promise<void> {
  const options = parseCodexWebBrokerArgs(args);
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }
  if (options.version) {
    console.log(APP_VERSION);
    return;
  }
  if (options.command === "hash-password") {
    const password = (await readStdin()).replace(/\r?\n$/, "");
    console.log(await hashBrokerPassword(password));
    return;
  }
  const platform = resolveRuntimeBrokerPlatform(process.platform);
  if (process.getuid?.() !== 0) throw new Error("serve 必须由 root 启动");

  const config = await readRuntimeBrokerConfig(options.configPath!, { expectedOwnerUid: 0 });
  const users = await resolveBrokerRuntimeUsers(config);
  const broker = await createRuntimeBrokerServer({
    socketPath: options.socketPath!,
    config,
    createRuntime: createBrokerRuntimeFactory(config, users, platform),
  });
  console.log(`Codex Web runtime broker 正在监听 ${broker.socketPath}`);
  const stop = async () => {
    await broker.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

function readStdin(): Promise<string> {
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    stdin.on("data", (chunk: string) => { value += chunk; });
    stdin.once("end", () => resolve(value));
    stdin.once("error", reject);
  });
}

const HELP_TEXT = `Codex Web Runtime

用法：
  codex-web runtime serve --config <绝对路径> --socket <绝对路径>
  printf '%s' '密码' | codex-web runtime hash-password

选项：
  -h, --help      显示帮助
  -v, --version   显示版本`;
