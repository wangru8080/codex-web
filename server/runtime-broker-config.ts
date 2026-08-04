import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { isBrokerPasswordHash } from "./runtime-broker-password";

export type RuntimeBrokerRole = "admin" | "user";

export type RuntimeBrokerUserConfig = {
  id: string;
  email: string;
  passwordHash: string;
  osUser: string;
  home: string;
  codexHome: string;
  cwd: string;
  env?: Record<string, string>;
  role: RuntimeBrokerRole;
  enabled: boolean;
  allowRoot: boolean;
  maxConcurrentTurns?: number;
};

export type RuntimeBrokerConfig = {
  version: 1;
  sessionSecret: string;
  sessionMaxAgeSeconds: number;
  disconnectGraceMs: number;
  maxActiveAppServers?: number;
  allowRootRuntime: boolean;
  codexCommand: string;
  setprivCommand: string;
  users: RuntimeBrokerUserConfig[];
};

type ReadConfigOptions = {
  expectedOwnerUid?: number;
};

export function parseRuntimeBrokerConfig(value: unknown): RuntimeBrokerConfig {
  const input = record(value, "broker 配置必须是 JSON 对象");
  if (input.version !== 1) throw new Error("broker 配置 version 必须是 1");
  const sessionSecret = requiredString(input.sessionSecret, "sessionSecret");
  if (sessionSecret.length < 32) throw new Error("sessionSecret 必须至少 32 个字符");
  const codexCommand = absolutePath(input.codexCommand, "codexCommand");
  const setprivCommand = input.setprivCommand === undefined
    ? "/usr/bin/setpriv"
    : absolutePath(input.setprivCommand, "setprivCommand");
  const allowRootRuntime = booleanValue(input.allowRootRuntime, false, "allowRootRuntime");
  const sessionMaxAgeSeconds = boundedInteger(
    input.sessionMaxAgeSeconds,
    259_200,
    60,
    604_800,
    "sessionMaxAgeSeconds",
  );
  const disconnectGraceMs = boundedInteger(
    input.disconnectGraceMs,
    30_000,
    0,
    600_000,
    "disconnectGraceMs",
  );
  const maxActiveAppServers = optionalPositiveInteger(
    input.maxActiveAppServers,
    "maxActiveAppServers",
  );
  if (!Array.isArray(input.users) || input.users.length === 0) {
    throw new Error("users 必须包含至少一个用户");
  }

  const ids = new Set<string>();
  const emails = new Set<string>();
  const users = input.users.map((item, index) => {
    const user = record(item, `users[${index}] 必须是对象`);
    const id = requiredString(user.id, `users[${index}].id`);
    if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(id)) throw new Error(`users[${index}].id 格式无效`);
    const email = requiredString(user.email, `users[${index}].email`).toLowerCase();
    const osUser = requiredString(user.osUser, `users[${index}].osUser`);
    if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(osUser)) throw new Error(`users[${index}].osUser 格式无效`);
    const passwordHash = requiredString(user.passwordHash, `users[${index}].passwordHash`);
    if (!isBrokerPasswordHash(passwordHash)) throw new Error(`users[${index}].passwordHash 格式无效`);
    const role = user.role === undefined ? "user" : user.role;
    if (role !== "admin" && role !== "user") throw new Error(`users[${index}].role 格式无效`);
    const allowRoot = booleanValue(user.allowRoot, false, `users[${index}].allowRoot`);
    const enabled = booleanValue(user.enabled, true, `users[${index}].enabled`);
    const env = environmentVariables(user.env, `users[${index}].env`);
    const maxConcurrentTurns = optionalPositiveInteger(
      user.maxConcurrentTurns,
      `users[${index}].maxConcurrentTurns`,
    );

    if (ids.has(id) || emails.has(email)) throw new Error(`users[${index}] 存在重复 id 或 email`);
    ids.add(id);
    emails.add(email);
    if (osUser === "root" && (!allowRootRuntime || !allowRoot)) {
      throw new Error("root 用户必须同时启用 allowRootRuntime 和 allowRoot");
    }

    return {
      id,
      email,
      passwordHash,
      osUser,
      home: absolutePath(user.home, `users[${index}].home`),
      codexHome: absolutePath(user.codexHome, `users[${index}].codexHome`),
      cwd: absolutePath(user.cwd, `users[${index}].cwd`),
      env,
      role,
      enabled,
      allowRoot,
      maxConcurrentTurns,
    } satisfies RuntimeBrokerUserConfig;
  });

  return {
    version: 1,
    sessionSecret,
    sessionMaxAgeSeconds,
    disconnectGraceMs,
    maxActiveAppServers,
    allowRootRuntime,
    codexCommand,
    setprivCommand,
    users,
  };
}

function optionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${name} 必须是正整数；不配置表示无限制`);
  }
  return value as number;
}

const PROTECTED_ENVIRONMENT_VARIABLES = new Set([
  "BASH_ENV",
  "CODEX_HOME",
  "ENV",
  "HOME",
  "LOGNAME",
  "NODE_ENV",
  "NODE_OPTIONS",
  "PERL5OPT",
  "PYTHONHOME",
  "PYTHONPATH",
  "RUBYOPT",
  "RUST_LOG",
  "SHELL",
  "USER",
]);

function environmentVariables(value: unknown, name: string): Record<string, string> {
  if (value === undefined) return {};
  const input = record(value, `${name} 必须是对象`);
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(input)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error(`${name}.${key} 名称无效`);
    if (
      PROTECTED_ENVIRONMENT_VARIABLES.has(key)
      || key.startsWith("LD_")
      || key.startsWith("DYLD_")
    ) throw new Error(`${name}.${key} 由 broker 管理或禁止设置`);
    if (typeof item !== "string") throw new Error(`${name}.${key} 必须是字符串`);
    output[key] = item;
  }
  return output;
}

export async function readRuntimeBrokerConfig(
  path: string,
  options: ReadConfigOptions = {},
): Promise<RuntimeBrokerConfig> {
  if (!isAbsolute(path)) throw new Error("broker 配置文件必须使用绝对路径");
  const metadata = await lstat(path);
  if (!metadata.isFile()) throw new Error("broker 配置必须是普通文件，不能是链接或目录");
  const expectedOwnerUid = options.expectedOwnerUid ?? process.getuid?.() ?? 0;
  if (metadata.uid !== expectedOwnerUid) throw new Error(`broker 配置所有者 UID 必须是 ${expectedOwnerUid}`);
  if ((metadata.mode & 0o777) !== 0o600) throw new Error("broker 配置权限必须是 0600");
  return parseRuntimeBrokerConfig(JSON.parse(await readFile(path, "utf8")) as unknown);
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} 必须是非空字符串`);
  return value.trim();
}

function absolutePath(value: unknown, name: string): string {
  const path = requiredString(value, name);
  if (!isAbsolute(path)) throw new Error(`${name} 必须是绝对路径`);
  return path;
}

function booleanValue(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${name} 必须是布尔值`);
  return value;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 的整数`);
  }
  return value as number;
}
