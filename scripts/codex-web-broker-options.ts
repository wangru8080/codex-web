import { isAbsolute } from "node:path";

export type CodexWebBrokerOptions = {
  command: "serve" | "hash-password";
  configPath?: string;
  socketPath?: string;
  help: boolean;
  version: boolean;
};

export function parseCodexWebBrokerArgs(args: string[]): CodexWebBrokerOptions {
  if (args.includes("--help") || args.includes("-h")) {
    return { command: "serve", help: true, version: false };
  }
  if (args.includes("--version") || args.includes("-v")) {
    return { command: "serve", help: false, version: true };
  }
  const command = args[0];
  if (command === "hash-password") {
    if (args.length !== 1) throw new Error("hash-password 不接受其他参数");
    return { command, help: false, version: false };
  }
  if (command !== "serve") throw new Error(`未知命令: ${command ?? ""}`);

  let configPath: string | undefined;
  let socketPath: string | undefined;
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value) throw new Error(`${flag} 缺少值`);
    if (flag === "--config") configPath = absolutePath(value, "--config");
    else if (flag === "--socket") socketPath = absolutePath(value, "--socket");
    else throw new Error(`未知参数: ${flag}`);
  }
  if (!configPath || !socketPath) throw new Error("serve 必须提供 --config 和 --socket");
  return { command, configPath, socketPath, help: false, version: false };
}

function absolutePath(value: string, name: string): string {
  if (!isAbsolute(value)) throw new Error(`${name} 必须是绝对路径`);
  return value;
}
