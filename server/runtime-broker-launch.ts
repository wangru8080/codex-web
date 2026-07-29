import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { promisify } from "node:util";

import type { CodexProcessOptions } from "./codex-process";
import { PersistentAppServer } from "./persistent-app-server";
import type { RuntimeBrokerConfig, RuntimeBrokerUserConfig } from "./runtime-broker-config";
import type { JsonRpcMessage } from "../src/codex/protocol/json-rpc";

export type RuntimeUserRecord = {
  uid: number;
  gid: number;
  home: string;
  shell: string;
};

export type RuntimeBrokerPlatform = "linux" | "darwin";

export type ResolvedBrokerRuntimeUser = RuntimeBrokerUserConfig & RuntimeUserRecord;

type RuntimeUserLookup = (osUser: string) => Promise<RuntimeUserRecord>;

const execFileAsync = promisify(execFile);

export async function resolveBrokerRuntimeUsers(
  config: RuntimeBrokerConfig,
  lookup: RuntimeUserLookup = lookupRuntimeUser,
): Promise<Map<string, ResolvedBrokerRuntimeUser>> {
  const resolved = new Map<string, ResolvedBrokerRuntimeUser>();
  for (const user of config.users) {
    const systemUser = await lookup(user.osUser);
    if (systemUser.home !== user.home) {
      throw new Error(`${user.id} 的配置 home 与系统用户 home 不一致`);
    }
    if (systemUser.uid === 0 && (
      user.osUser !== "root" || !config.allowRootRuntime || !user.allowRoot
    )) {
      throw new Error(`${user.id} 解析为 UID 0，但没有 root 双重授权`);
    }
    resolved.set(user.id, { ...user, ...systemUser });
  }
  return resolved;
}

export function buildBrokerRuntimeProcessOptions(
  config: RuntimeBrokerConfig,
  user: ResolvedBrokerRuntimeUser,
  platform: RuntimeBrokerPlatform = resolveRuntimeBrokerPlatform(process.platform),
): CodexProcessOptions {
  const userEnv = user.env ?? {};
  const env = {
    ...userEnv,
    HOME: user.home,
    USER: user.osUser,
    LOGNAME: user.osUser,
    SHELL: user.shell,
    PATH: userEnv.PATH ?? `${dirname(config.codexCommand)}:/usr/local/bin:/usr/bin:/bin`,
    NODE_ENV: "production",
    RUST_LOG: "warn",
  };
  const common = {
    cwd: user.cwd,
    codexHome: user.codexHome,
    env,
    inheritEnv: false,
  } satisfies CodexProcessOptions;

  if (user.uid === 0) {
    return { ...common, command: config.codexCommand, args: ["app-server", "--stdio"] };
  }
  if (platform === "darwin") {
    const targetEnv = Object.entries({ ...env, CODEX_HOME: user.codexHome })
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, value]) => `${key}=${value}`);
    return {
      ...common,
      command: "/usr/bin/sudo",
      args: [
        "-n",
        "-H",
        "-u",
        user.osUser,
        "--",
        "/usr/bin/env",
        "-i",
        ...targetEnv,
        config.codexCommand,
        "app-server",
        "--stdio",
      ],
    };
  }
  return {
    ...common,
    command: config.setprivCommand,
    args: [
      `--reuid=${user.uid}`,
      `--regid=${user.gid}`,
      "--init-groups",
      "--inh-caps=-all",
      "--ambient-caps=-all",
      "--bounding-set=-all",
      "--pdeathsig=SIGTERM",
      "--",
      config.codexCommand,
      "app-server",
      "--stdio",
    ],
  };
}

export function createBrokerRuntimeFactory(
  config: RuntimeBrokerConfig,
  users: Map<string, ResolvedBrokerRuntimeUser>,
  platform: RuntimeBrokerPlatform = resolveRuntimeBrokerPlatform(process.platform),
): (user: RuntimeBrokerUserConfig, onNotification: (message: JsonRpcMessage) => void) => PersistentAppServer {
  return (user, onNotification) => {
    const resolved = users.get(user.id);
    if (!resolved) throw new Error(`未解析 runtime 用户: ${user.id}`);
    return new PersistentAppServer(buildBrokerRuntimeProcessOptions(config, resolved, platform), onNotification);
  };
}

export function resolveRuntimeBrokerPlatform(platform: NodeJS.Platform): RuntimeBrokerPlatform {
  if (platform === "linux" || platform === "darwin") return platform;
  throw new Error("多用户 runtime 仅支持 Linux 和 macOS");
}

export async function lookupRuntimeUser(
  osUser: string,
  platform: RuntimeBrokerPlatform = resolveRuntimeBrokerPlatform(process.platform),
): Promise<RuntimeUserRecord> {
  if (platform === "darwin") {
    const { stdout } = await execFileAsync(
      "/usr/bin/dscacheutil",
      ["-q", "user", "-a", "name", osUser],
      { encoding: "utf8" },
    );
    return parseDarwinUserRecord(osUser, stdout);
  }

  const { stdout } = await execFileAsync("/usr/bin/getent", ["passwd", osUser], { encoding: "utf8" });
  const line = stdout.trim().split("\n")[0];
  const fields = line?.split(":") ?? [];
  const uid = Number(fields[2]);
  const gid = Number(fields[3]);
  const home = fields[5];
  const shell = fields[6];
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0 || !home || !shell) {
    throw new Error(`无法解析 Linux 用户: ${osUser}`);
  }
  return { uid, gid, home, shell };
}

export function parseDarwinUserRecord(osUser: string, stdout: string): RuntimeUserRecord {
  const attributes = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    attributes.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const uidValue = attributes.get("uid") ?? "";
  const gidValue = attributes.get("gid") ?? "";
  const home = attributes.get("dir") ?? "";
  const shell = attributes.get("shell") ?? "";
  const uid = /^\d+$/.test(uidValue) ? Number(uidValue) : Number.NaN;
  const gid = /^\d+$/.test(gidValue) ? Number(gidValue) : Number.NaN;
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || !home || !shell) {
    throw new Error(`无法解析 macOS 用户: ${osUser}`);
  }
  return { uid, gid, home, shell };
}
