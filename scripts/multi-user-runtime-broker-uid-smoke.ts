import { spawnSync } from "node:child_process";
import {
  chmod,
  chown,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { RuntimeBrokerClient, type RuntimeBrokerConnection } from "../server/runtime-broker-client";
import { parseRuntimeBrokerConfig } from "../server/runtime-broker-config";
import { createBrokerRuntimeFactory, resolveBrokerRuntimeUsers } from "../server/runtime-broker-launch";
import { hashBrokerPassword } from "../server/runtime-broker-password";
import { createRuntimeBrokerServer, type RuntimeBrokerServer } from "../server/runtime-broker-server";
import type { JsonRpcMessage } from "../src/codex/protocol/json-rpc";

const tempRoot = "/volume2/SSD/codex/Temp";
const password = `uid-smoke-${Date.now()}`;

type Identity = {
  pid: number;
  uid: number;
  euid: number;
  gid: number;
  egid: number;
  groups: number[];
  cwd: string;
  env: Record<string, string | boolean | undefined>;
  capabilities: { effective: string; bounding: string };
};

async function main(): Promise<void> {
  if (process.getuid?.() !== 0) {
    throw new Error("UID smoke 必须由 root 执行，请使用 sudo 运行 npm 命令");
  }
  assertCommand("/usr/bin/setpriv", ["--version"]);
  process.env.UID_SMOKE_BROKER_ONLY = "broker-only";

  const runDirectory = await mkdtemp(join(tempRoot, "codex-web-multi-user-uid-smoke-"));
  await chmod(runDirectory, 0o711);
  const fixtureCommand = join(runDirectory, "fixture-app-server.mjs");
  await writeFile(fixtureCommand, fixtureSource(), { flag: "wx", mode: 0o755 });
  await chmod(fixtureCommand, 0o755);

  const systemUsers = await resolveSystemUsers(["rrssnas", "codex"]);
  const paths = new Map<string, { cwd: string; codexHome: string }>();
  for (const user of systemUsers.values()) {
    const cwd = join(runDirectory, `${user.name}-cwd`);
    const codexHome = join(runDirectory, `${user.name}-codex-home`);
    await mkdir(cwd, { mode: 0o700 });
    await mkdir(codexHome, { mode: 0o700 });
    await chown(cwd, user.uid, user.gid);
    await chown(codexHome, user.uid, user.gid);
    paths.set(user.name, { cwd, codexHome });
  }

  let broker: RuntimeBrokerServer | null = null;
  const connections: RuntimeBrokerConnection[] = [];
  const connectionsByUser = new Map<string, RuntimeBrokerConnection>();
  try {
    const passwordHash = await hashBrokerPassword(password);
    const config = parseRuntimeBrokerConfig({
      version: 1,
      sessionSecret: "uid-smoke-session-secret-2026-0123456789",
      disconnectGraceMs: 100,
      codexCommand: fixtureCommand,
      setprivCommand: "/usr/bin/setpriv",
      users: [...systemUsers.values()].map((user) => ({
        id: user.name,
        email: `${user.name}@example.test`,
        passwordHash,
        osUser: user.name,
        home: user.home,
        codexHome: paths.get(user.name)?.codexHome,
        cwd: paths.get(user.name)?.cwd,
        inheritLoginEnvironment: true,
        env: {
          PATH: "/volume2/SSD/node-v24.14.0/bin:/usr/bin:/bin",
          UID_SMOKE_USER: user.name,
        },
      })),
    });
    const resolvedUsers = await resolveBrokerRuntimeUsers(config);
    broker = await createRuntimeBrokerServer({
      socketPath: join(runDirectory, "runtime-broker.sock"),
      config,
      createRuntime: createBrokerRuntimeFactory(config, resolvedUsers),
    });
    const client = new RuntimeBrokerClient(broker.socketPath);

    for (const user of systemUsers.values()) {
      const login = await client.login(`${user.name}@example.test`, password, "127.0.0.1");
      const connection = await client.attachRuntime(login.token);
      connections.push(connection);
      connectionsByUser.set(user.name, connection);
    }

    const identities = new Map<string, Identity>();
    for (const user of systemUsers.values()) {
      const identityPath = join(paths.get(user.name)!.codexHome, "identity.json");
      await waitForFile(identityPath);
      const identity = JSON.parse(await readFile(identityPath, "utf8")) as Identity;
      assertIdentity(user, paths.get(user.name)!, connectionsByUser.get(user.name)!, identity);
      identities.set(user.name, identity);
    }

    const rrssnasConnection = connectionsByUser.get("rrssnas")!;
    const codexConnection = connectionsByUser.get("codex")!;
    for (const user of systemUsers.values()) {
      const env = identities.get(user.name)?.env;
      if (env?.UID_SMOKE_USER !== user.name) {
        throw new Error(`${user.name} runtime 未获得自己的用户环境标记`);
      }
      if (env.UID_SMOKE_BROKER_ONLY !== undefined) {
        throw new Error(`${user.name} runtime 泄漏了 Broker 全局环境`);
      }
    }
    const rrssnasOtherPath = join(paths.get("codex")!.codexHome, "identity.json");
    const codexOtherPath = join(paths.get("rrssnas")!.codexHome, "identity.json");
    const [rrssnasCrossRead, codexCrossRead] = await Promise.all([
      request(rrssnasConnection, 101, "smoke/read", { path: rrssnasOtherPath }),
      request(codexConnection, 102, "smoke/read", { path: codexOtherPath }),
    ]);
    assertDenied(rrssnasCrossRead, "rrssnas");
    assertDenied(codexCrossRead, "codex");

    const runtimePids = [...identities.values()].map((identity) => identity.pid);
    for (const connection of connections.splice(0)) connection.close();
    await waitFor(() => broker?.runtimeCount() === 0, 5_000);
    await waitFor(() => runtimePids.every((pid) => !processExists(pid)), 5_000);

    const result = {
      passed: true,
      runDirectory,
      broker: { uid: process.getuid(), gid: process.getgid?.() },
      users: Object.fromEntries([...identities].map(([id, identity]) => [id, identity])),
      crossUserReadsDenied: true,
      environmentIsolationVerified: true,
      loginProfileGithubTokenPresent: Object.fromEntries(
        [...identities].map(([id, identity]) => [id, identity.env.GITHUB_PAT_TOKEN_SET === true]),
      ),
      runtimesStopped: true,
      realCodexHomeUsed: false,
    };
    const resultPath = join(runDirectory, "result.json");
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await chown(resultPath, systemUsers.get("rrssnas")!.uid, systemUsers.get("rrssnas")!.gid);
    console.log(JSON.stringify({ ...result, resultPath }, null, 2));
  } catch (error) {
    const errorPath = join(runDirectory, "error.json");
    await writeFile(errorPath, `${JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await chown(errorPath, systemUsers.get("rrssnas")!.uid, systemUsers.get("rrssnas")!.gid);
    throw error;
  } finally {
    for (const connection of connections) connection.close();
    await broker?.close();
  }
}

type SystemUser = { name: string; uid: number; gid: number; home: string };

async function resolveSystemUsers(names: string[]): Promise<Map<string, SystemUser>> {
  const users = new Map<string, SystemUser>();
  for (const name of names) {
    const result = spawnSync("/usr/bin/getent", ["passwd", name], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`系统用户不存在：${name}`);
    const fields = result.stdout.trim().split(":");
    const uid = Number(fields[2]);
    const gid = Number(fields[3]);
    const home = fields[5];
    if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || !home) {
      throw new Error(`系统用户信息无效：${name}`);
    }
    users.set(name, { name, uid, gid, home });
  }
  return users;
}

function assertIdentity(
  user: SystemUser,
  paths: { cwd: string; codexHome: string },
  connection: RuntimeBrokerConnection,
  identity: Identity,
): void {
  if (connection.pid !== identity.pid) throw new Error(`${user.name} broker PID 与 runtime PID 不一致`);
  if (identity.uid !== user.uid || identity.euid !== user.uid) throw new Error(`${user.name} UID 未正确切换`);
  if (identity.gid !== user.gid || identity.egid !== user.gid) throw new Error(`${user.name} GID 未正确切换`);
  if (identity.env.HOME !== user.home || identity.env.USER !== user.name || identity.env.LOGNAME !== user.name) {
    throw new Error(`${user.name} 用户环境未正确隔离`);
  }
  if (identity.env.CODEX_HOME !== paths.codexHome || identity.cwd !== paths.cwd) {
    throw new Error(`${user.name} CODEX_HOME 或 cwd 未正确隔离`);
  }
  if (identity.capabilities.effective !== "0000000000000000" || identity.capabilities.bounding !== "0000000000000000") {
    throw new Error(`${user.name} runtime 仍保留 Linux capability`);
  }
}

async function request(
  connection: RuntimeBrokerConnection,
  id: number,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} 响应超时`)), 5_000);
    const unsubscribe = connection.onMessage((message) => {
      if (!("id" in message) || message.id !== id) return;
      clearTimeout(timeout);
      unsubscribe();
      if ("error" in message && message.error) reject(new Error(message.error.message));
      else resolve("result" in message ? message.result : undefined);
    });
    connection.send({ id, method, params });
  });
}

function assertDenied(value: unknown, user: string): void {
  if (!value || typeof value !== "object" || (value as { readable?: unknown }).readable !== false) {
    throw new Error(`${user} 可以读取另一个用户的隔离文件`);
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(path: string): Promise<void> {
  await waitFor(async () => {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  }, 5_000);
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("等待 UID smoke 状态超时");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function assertCommand(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "ignore" });
  if (result.status !== 0) throw new Error(`命令不可用：${command}`);
}

function fixtureSource(): string {
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const status = readFileSync("/proc/self/status", "utf8");
const capability = (name) => status.match(new RegExp("^" + name + ":\\\\s*([0-9a-f]+)$", "mi"))?.[1] ?? "";
const identity = {
  pid: process.pid,
  uid: process.getuid(),
  euid: process.geteuid(),
  gid: process.getgid(),
  egid: process.getegid(),
  groups: process.getgroups(),
  cwd: process.cwd(),
  env: {
    HOME: process.env.HOME,
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    CODEX_HOME: process.env.CODEX_HOME,
    NODE_ENV: process.env.NODE_ENV,
    RUST_LOG: process.env.RUST_LOG,
    GITHUB_PAT_TOKEN_SET: typeof process.env.GITHUB_PAT_TOKEN === "string" && process.env.GITHUB_PAT_TOKEN.length > 0,
    UID_SMOKE_USER: process.env.UID_SMOKE_USER,
    UID_SMOKE_BROKER_ONLY: process.env.UID_SMOKE_BROKER_ONLY,
  },
  capabilities: { effective: capability("CapEff"), bounding: capability("CapBnd") },
};
writeFileSync(process.env.CODEX_HOME + "/identity.json", JSON.stringify(identity, null, 2) + "\\n", { flag: "wx", mode: 0o600 });

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  let result = identity;
  if (request.method === "smoke/read") {
    try {
      readFileSync(request.params.path);
      result = { readable: true };
    } catch (error) {
      result = { readable: false, code: error?.code };
    }
  }
  if (request.id !== undefined) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
  }
});
`;
}

await main();
