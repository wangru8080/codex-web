import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmod, chown, lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

import { hashBrokerPassword } from "../server/runtime-broker-password";
import { CdpBrowser, type CdpClient } from "./multi-user-runtime-broker-smoke";

const tempRoot = "/volume2/SSD/codex/Temp";
const cdpEndpoint = process.env.CODEX_WEB_CDP_URL ?? "http://192.168.3.12:45737";
const nodeCommand = "/volume2/SSD/node-v24.14.0/bin/node";
const setprivCommand = "/usr/bin/setpriv";
const sharedGroupId = 133;
const password = `unified-cli-browser-smoke-${Date.now()}`;
const altPassword = `unified-cli-browser-smoke-alt-${Date.now()}`;

type SystemUser = { name: string; uid: number; gid: number; home: string };
type RuntimeIdentity = { pid: number; uid: number; gid: number; codexHome: string; cwd: string };
type RuntimePaths = { cwd: string; codexHome: string };
type FixtureUser = {
  id: string;
  email: string;
  passwordHash: string;
  osUser: string;
  home: string;
  codexHome: string;
  cwd: string;
  env: { PATH: string };
};

async function main(): Promise<void> {
  if (process.getuid?.() !== 0) throw new Error("统一 CLI 浏览器 smoke 必须由 root 执行");

  const repositoryRoot = resolve(import.meta.dirname, "..");
  const cli = join(repositoryRoot, "dist/cli/codex-web.mjs");
  const runDirectory = await mkdtemp(join(tempRoot, "codex-web-unified-cli-browser-smoke-"));
  await chmod(runDirectory, 0o711);
  const users = new Map([
    ["rrssnas", resolveSystemUser("rrssnas")],
    ["codex", resolveSystemUser("codex")],
  ]);
  const paths = new Map<string, RuntimePaths>();
  for (const user of users.values()) {
    paths.set(user.name, await createRuntimePaths(runDirectory, user.name, user));
  }
  const rrssnasAltPaths = await createRuntimePaths(runDirectory, "rrssnas-alt", users.get("rrssnas")!);
  const codexNextPaths = await createRuntimePaths(runDirectory, "codex-next", users.get("codex")!);

  const webState = join(runDirectory, "web-state");
  const socketDirectory = join(runDirectory, "run");
  await mkdir(webState, { mode: 0o700 });
  await chown(webState, users.get("rrssnas")!.uid, users.get("rrssnas")!.gid);
  await mkdir(socketDirectory, { mode: 0o750 });
  await chown(socketDirectory, 0, sharedGroupId);

  const fixtureCommand = join(runDirectory, "fixture-app-server.mjs");
  await writeFile(fixtureCommand, fixtureSource(), { flag: "wx", mode: 0o755 });
  await chmod(fixtureCommand, 0o755);
  const configPath = join(runDirectory, "users.json");
  const passwordHash = await hashBrokerPassword(password);
  const altPasswordHash = await hashBrokerPassword(altPassword);
  const initialUsers = [...users.values()].map((user) => fixtureUser(
    user.name,
    user,
    paths.get(user.name)!,
    passwordHash,
  ));
  const initialConfig = {
    version: 1,
    sessionSecret: "unified-cli-browser-smoke-session-secret-2026",
    disconnectGraceMs: 200,
    codexCommand: fixtureCommand,
    setprivCommand,
    users: initialUsers,
  };
  await writeConfig(configPath, initialConfig, true);

  const socketPath = join(socketDirectory, "runtime.sock");
  const port = await findAvailablePort();
  let runtime: ChildProcess | null = null;
  let web: ChildProcess | null = null;
  let browser: CdpBrowser | null = null;
  const childLogs = { runtime: [] as string[], web: [] as string[] };
  try {
    const runtimeChild = spawn(nodeCommand, [
      cli, "runtime", "serve", "--config", configPath, "--socket", socketPath,
    ], {
      cwd: repositoryRoot,
      env: {
        PATH: "/volume2/SSD/node-v24.14.0/bin:/usr/bin:/bin",
        NODE_ENV: "production",
      },
      uid: 0,
      gid: sharedGroupId,
      stdio: ["ignore", "pipe", "pipe"],
    });
    runtime = runtimeChild;
    forwardOutput("runtime", runtimeChild, childLogs.runtime);
    await waitForFileOrExit(socketPath, runtimeChild, childLogs.runtime, 10_000);

    const rrssnas = users.get("rrssnas")!;
    web = spawn(setprivCommand, [
      `--reuid=${rrssnas.uid}`,
      `--regid=${rrssnas.gid}`,
      "--init-groups",
      "--inh-caps=-all",
      "--ambient-caps=-all",
      "--bounding-set=-all",
      "--pdeathsig=SIGTERM",
      "--",
      nodeCommand,
      cli,
      "serve",
      "--host", "0.0.0.0",
      "--port", String(port),
    ], {
      cwd: repositoryRoot,
      env: {
        PATH: "/volume2/SSD/node-v24.14.0/bin:/usr/bin:/bin",
        HOME: rrssnas.home,
        USER: rrssnas.name,
        LOGNAME: rrssnas.name,
        SHELL: "/bin/bash",
        CODEX_HOME: webState,
        CODEX_WEB_RUNTIME_BROKER_SOCKET: socketPath,
        NODE_ENV: "production",
        RUST_LOG: "warn",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    forwardOutput("web", web, childLogs.web);
    await waitForHttp(`http://127.0.0.1:${port}/login`, 120_000);

    browser = await CdpBrowser.connect(cdpEndpoint);
    const rrssnasPage = await browser.createPage();
    const codexPage = await browser.createPage();
    const baseUrl = `http://192.168.3.12:${port}`;
    await login(rrssnasPage, baseUrl, "rrssnas@example.test");
    await login(codexPage, baseUrl, "codex@example.test");

    const rrssnasIdentity = await readRuntimeIdentity(paths.get("rrssnas")!.codexHome);
    const codexIdentity = await readRuntimeIdentity(paths.get("codex")!.codexHome);
    assertIdentity(rrssnasIdentity, users.get("rrssnas")!, paths.get("rrssnas")!);
    assertIdentity(codexIdentity, users.get("codex")!, paths.get("codex")!);

    const rrssnasSecond = await browser.createPage(rrssnasPage.contextId, `${baseUrl}/chat`);
    await rrssnasSecond.waitFor("location.pathname === '/chat'", 30_000);
    await sendMarker(rrssnasPage, "rrssnas-marker");
    await sendMarker(rrssnasSecond, "rrssnas-second-marker");
    await sendMarker(codexPage, "codex-marker");
    await waitFor(async () => (
      (await readMarkers(paths.get("rrssnas")!.codexHome)).includes("rrssnas-marker")
      && (await readMarkers(paths.get("rrssnas")!.codexHome)).includes("rrssnas-second-marker")
      && (await readMarkers(paths.get("codex")!.codexHome)).includes("codex-marker")
    ), 5_000);
    const rrssnasMarkers = await readMarkers(paths.get("rrssnas")!.codexHome);
    const codexMarkers = await readMarkers(paths.get("codex")!.codexHome);
    if (rrssnasMarkers.includes("codex-marker") || codexMarkers.includes("rrssnas-marker")) {
      throw new Error("跨用户 marker 串入另一个 runtime");
    }

    const altPage = await browser.createPage();
    await writeFile(configPath, "{ invalid json\n");
    await waitFor(() => childLogs.runtime.join("").includes("配置重载失败"), 5_000);
    if (await loginStatus(altPage, baseUrl, "rrssnas-alt@example.test", altPassword) !== 401) {
      throw new Error("无效配置错误地新增了登录用户");
    }
    await sendMarker(rrssnasPage, "rrssnas-after-invalid-config");
    await waitFor(async () => (
      (await readMarkers(paths.get("rrssnas")!.codexHome)).includes("rrssnas-after-invalid-config")
    ), 5_000);
    if (!processExists(rrssnasIdentity.pid) || !processExists(codexIdentity.pid)) {
      throw new Error("无效配置中断了当前 runtime");
    }

    const equivalentReloads = reloadSuccessCount(childLogs.runtime);
    await writeConfig(configPath, initialConfig);
    await waitFor(() => reloadSuccessCount(childLogs.runtime) > equivalentReloads, 5_000);
    await sendMarker(codexPage, "codex-after-equivalent-config");
    await waitFor(async () => (
      (await readMarkers(paths.get("codex")!.codexHome)).includes("codex-after-equivalent-config")
    ), 5_000);
    if (!processExists(rrssnasIdentity.pid) || !processExists(codexIdentity.pid)) {
      throw new Error("等价配置保存重启了未变化 runtime");
    }

    const altUser = fixtureUser("rrssnas-alt", users.get("rrssnas")!, rrssnasAltPaths, altPasswordHash);
    const addUserReloads = reloadSuccessCount(childLogs.runtime);
    await writeConfig(configPath, { ...initialConfig, users: [...initialUsers, altUser] });
    await waitFor(() => reloadSuccessCount(childLogs.runtime) > addUserReloads, 5_000);
    if (await loginStatus(altPage, baseUrl, altUser.email, password) !== 401) {
      throw new Error("新增账号错误接受了原账号密码");
    }
    const primaryCredentialProbe = await browser.createPage();
    if (await loginStatus(primaryCredentialProbe, baseUrl, "rrssnas@example.test", altPassword) !== 401) {
      throw new Error("原账号错误接受了新增账号密码");
    }
    await login(altPage, baseUrl, altUser.email, altPassword);
    const altIdentity = await readRuntimeIdentity(rrssnasAltPaths.codexHome);
    assertIdentity(altIdentity, users.get("rrssnas")!, rrssnasAltPaths);
    await sendMarker(altPage, "rrssnas-alt-marker");

    const nextCodexUser = fixtureUser("codex", users.get("codex")!, codexNextPaths, passwordHash);
    const changeUserReloads = reloadSuccessCount(childLogs.runtime);
    await writeConfig(configPath, {
      ...initialConfig,
      users: [initialUsers[0]!, nextCodexUser, altUser],
    });
    await waitFor(() => reloadSuccessCount(childLogs.runtime) > changeUserReloads, 5_000);
    await waitFor(() => !processExists(codexIdentity.pid), 5_000);
    if (!processExists(rrssnasIdentity.pid) || !processExists(altIdentity.pid)) {
      throw new Error("修改 codex 配置影响了未变化用户 runtime");
    }
    await login(codexPage, baseUrl, nextCodexUser.email);
    const codexNextIdentity = await readRuntimeIdentity(codexNextPaths.codexHome);
    assertIdentity(codexNextIdentity, users.get("codex")!, codexNextPaths);
    await sendMarker(codexPage, "codex-next-home-marker");

    await logout(rrssnasPage);
    await delay(500);
    if (!processExists(rrssnasIdentity.pid)) throw new Error("同用户第二页面仍在线时 runtime 被关闭");
    await logout(rrssnasSecond);
    await logout(codexPage);
    await logout(altPage);
    await waitFor(() => (
      !processExists(rrssnasIdentity.pid)
      && !processExists(altIdentity.pid)
      && !processExists(codexNextIdentity.pid)
    ), 5_000);

    const finalRrssnasMarkers = await readMarkers(paths.get("rrssnas")!.codexHome);
    const finalCodexMarkers = await readMarkers(paths.get("codex")!.codexHome);
    const altMarkers = await readMarkers(rrssnasAltPaths.codexHome);
    const codexNextMarkers = await readMarkers(codexNextPaths.codexHome);

    const resultPath = join(runDirectory, "result.json");
    const result = {
      passed: true,
      runDirectory,
      commands: {
        runtime: "codex-web runtime serve",
        web: "codex-web serve",
      },
      browser: "Chrome 150 CDP",
      users: {
        rrssnas: rrssnasIdentity,
        codexBeforeReload: codexIdentity,
        codexAfterReload: codexNextIdentity,
        rrssnasAlt: altIdentity,
      },
      markers: {
        rrssnas: finalRrssnasMarkers,
        codexBeforeReload: finalCodexMarkers,
        codexAfterReload: codexNextMarkers,
        rrssnasAlt: altMarkers,
      },
      sameUserRuntimeReused: true,
      invalidConfigKeptCurrentRuntime: true,
      equivalentConfigKeptRuntimePids: true,
      addedUserLoggedInWithoutRestart: true,
      sameOsUserDifferentCredentialsHotLoaded: true,
      crossedPasswordsRejected: true,
      changedUserRuntimeReplaced: true,
      unchangedUsersStayedOnline: true,
      runtimesStopped: true,
      realCodexHomeUsed: false,
    };
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await chown(resultPath, rrssnas.uid, rrssnas.gid);
    console.log(JSON.stringify({ ...result, resultPath }, null, 2));
  } catch (error) {
    const errorPath = join(runDirectory, "error.json");
    await writeFile(errorPath, `${JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      childLogs,
    }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await chown(errorPath, users.get("rrssnas")!.uid, users.get("rrssnas")!.gid);
    throw error;
  } finally {
    await browser?.close();
    await stopProcess(web);
    await stopProcess(runtime);
  }
}

async function createRuntimePaths(
  runDirectory: string,
  name: string,
  user: SystemUser,
): Promise<RuntimePaths> {
  const cwd = join(runDirectory, `${name}-cwd`);
  const codexHome = join(runDirectory, `${name}-codex-home`);
  await mkdir(cwd, { mode: 0o700 });
  await mkdir(codexHome, { mode: 0o700 });
  await chown(cwd, user.uid, user.gid);
  await chown(codexHome, user.uid, user.gid);
  return { cwd, codexHome };
}

function fixtureUser(
  id: string,
  user: SystemUser,
  paths: RuntimePaths,
  passwordHash: string,
): FixtureUser {
  return {
    id,
    email: `${id}@example.test`,
    passwordHash,
    osUser: user.name,
    home: user.home,
    codexHome: paths.codexHome,
    cwd: paths.cwd,
    env: { PATH: "/volume2/SSD/node-v24.14.0/bin:/usr/bin:/bin" },
  };
}

async function writeConfig(path: string, value: object, create = false): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    ...(create ? { flag: "wx" as const } : {}),
    mode: 0o600,
  });
}

function reloadSuccessCount(logs: string[]): number {
  return logs.join("").split("已重新加载配置").length - 1;
}

function resolveSystemUser(name: string): SystemUser {
  const result = spawnSync("/usr/bin/getent", ["passwd", name], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`系统用户不存在：${name}`);
  const fields = result.stdout.trim().split(":");
  const uid = Number(fields[2]);
  const gid = Number(fields[3]);
  const home = fields[5];
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || !home) {
    throw new Error(`系统用户信息无效：${name}`);
  }
  return { name, uid, gid, home };
}

function forwardOutput(name: string, child: ChildProcess, logs: string[]): void {
  child.stdout?.on("data", (chunk: Buffer) => {
    logs.push(chunk.toString("utf8"));
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    logs.push(chunk.toString("utf8"));
    process.stderr.write(`[${name}] ${chunk}`);
  });
}

async function login(
  page: CdpClient,
  baseUrl: string,
  email: string,
  loginPassword = password,
): Promise<void> {
  await page.navigate(`${baseUrl}/login`);
  await page.waitFor("Boolean(document.querySelector('[data-testid=web-login-form]'))", 30_000);
  const status = await page.evaluate<number>(`fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(loginPassword)} }),
  }).then((response) => response.status)`);
  if (status !== 200) throw new Error(`${email} 登录失败：HTTP ${status}`);
  await page.navigate(`${baseUrl}/chat`);
  await page.waitFor("location.pathname === '/chat'", 30_000);
}

async function loginStatus(
  page: CdpClient,
  baseUrl: string,
  email: string,
  loginPassword = password,
): Promise<number> {
  await page.navigate(`${baseUrl}/login`);
  await page.waitFor("Boolean(document.querySelector('[data-testid=web-login-form]'))", 30_000);
  return await page.evaluate<number>(`fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(loginPassword)} }),
  }).then((response) => response.status)`);
}

async function sendMarker(page: CdpClient, marker: string): Promise<void> {
  await page.evaluate(`(async () => {
    const config = await fetch('/api/codex/bridge-url', { cache: 'no-store' }).then((response) => response.json());
    const url = new URL(config.bridgeUrl, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url.href);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    window.__codexWebUnifiedSmokeSockets = window.__codexWebUnifiedSmokeSockets || [];
    window.__codexWebUnifiedSmokeSockets.push(socket);
    socket.send(JSON.stringify({ id: 991, method: 'smoke/identity', params: { marker: ${JSON.stringify(marker)} } }));
  })()`);
}

async function logout(page: CdpClient): Promise<void> {
  await page.evaluate(`(async () => {
    for (const socket of window.__codexWebUnifiedSmokeSockets || []) socket.close();
    window.__codexWebUnifiedSmokeSockets = [];
    await fetch('/api/auth/logout', { method: 'POST' });
    window.dispatchEvent(new Event('codex-web:logout'));
    location.href = '/login';
  })()`);
  await page.waitFor("location.pathname === '/login'", 30_000);
}

async function readRuntimeIdentity(codexHome: string): Promise<RuntimeIdentity> {
  const path = join(codexHome, "identity.json");
  await waitForFile(path, 10_000);
  return JSON.parse(await readFile(path, "utf8")) as RuntimeIdentity;
}

function assertIdentity(
  identity: RuntimeIdentity,
  user: SystemUser,
  paths: { cwd: string; codexHome: string },
): void {
  if (identity.uid !== user.uid || identity.gid !== user.gid) throw new Error(`${user.name} UID/GID 不匹配`);
  if (identity.codexHome !== paths.codexHome || identity.cwd !== paths.cwd) {
    throw new Error(`${user.name} CODEX_HOME/cwd 不匹配`);
  }
}

async function readMarkers(codexHome: string): Promise<string[]> {
  try {
    return (await readFile(join(codexHome, "markers.txt"), "utf8")).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法分配 smoke 端口");
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return address.port;
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  await waitFor(async () => {
    try {
      return (await fetch(url, { redirect: "manual" })).status < 500;
    } catch {
      return false;
    }
  }, timeoutMs);
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  await waitFor(async () => {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  }, timeoutMs);
}

async function waitForFileOrExit(
  path: string,
  child: ChildProcess,
  logs: string[],
  timeoutMs: number,
): Promise<void> {
  await waitFor(async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`runtime 提前退出：code=${child.exitCode ?? "null"} signal=${child.signalCode ?? "null"}\n${logs.join("")}`);
    }
    try {
      return (await lstat(path)).isSocket();
    } catch {
      return false;
    }
  }, timeoutMs);
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("等待统一 CLI smoke 状态超时");
    await delay(50);
  }
}

async function stopProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise())),
    delay(10_000),
  ]);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function fixtureSource(): string {
  return `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const identity = {
  pid: process.pid,
  uid: process.getuid(),
  gid: process.getgid(),
  codexHome: process.env.CODEX_HOME,
  cwd: process.cwd(),
};
writeFileSync(process.env.CODEX_HOME + "/identity.json", JSON.stringify(identity, null, 2) + "\\n", { flag: "wx", mode: 0o600 });

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "smoke/identity" && typeof request.params?.marker === "string") {
    appendFileSync(process.env.CODEX_HOME + "/markers.txt", request.params.marker + "\\n", { mode: 0o600 });
  }
  let result = { ok: true };
  if (request.method === "initialize") result = {
    userAgent: "codex-web-unified-cli-smoke",
    codexHome: process.env.CODEX_HOME,
    platformFamily: "unix",
    platformOs: "linux",
  };
  else if (request.method === "model/list") result = { data: [], nextCursor: null };
  else if (request.method === "account/read") result = { account: null, requiresOpenaiAuth: false };
  else if (request.method === "thread/list") result = { data: [], nextCursor: null, backwardsCursor: null };
  else if (request.method === "config/read") result = { config: {}, origins: {}, layers: null };
  if (request.id !== undefined) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
  }
});
`;
}

await main();
