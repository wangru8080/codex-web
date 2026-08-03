import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

import type { AppServerPeer } from "../server/app-server-peer";
import { RuntimeBrokerClient } from "../server/runtime-broker-client";
import {
  parseRuntimeBrokerConfig,
  readRuntimeBrokerConfig,
  type RuntimeBrokerUserConfig,
} from "../server/runtime-broker-config";
import { watchRuntimeBrokerConfig } from "../server/runtime-broker-config-watcher";
import { hashBrokerPassword } from "../server/runtime-broker-password";
import { createRuntimeBrokerServer } from "../server/runtime-broker-server";
import type { UserRuntimeServer } from "../server/user-runtime-registry";
import type { JsonRpcMessage, JsonRpcRequest } from "../src/codex/protocol/json-rpc";

const cdpEndpoint = process.env.CODEX_WEB_CDP_URL ?? "http://192.168.3.12:45737";
const tempRoot = "/volume2/SSD/codex/Temp";
const password = `browser-smoke-${Date.now()}`;
const altPassword = `browser-smoke-alt-${Date.now()}`;
const runtimeStates = new Map<string, RuntimeState>();

async function main(): Promise<void> {
  const runDirectory = await mkdtemp(join(tempRoot, "codex-web-multi-user-browser-smoke-"));
  await chmod(runDirectory, 0o700);
  const passwordHash = await hashBrokerPassword(password);
  const altPasswordHash = await hashBrokerPassword(altPassword);
  const configPath = join(runDirectory, "users.json");
  const initialConfig = {
    version: 1,
    sessionSecret: "multi-user-browser-smoke-session-secret-2026",
    disconnectGraceMs: 200,
    codexCommand: "/fixture/codex",
    users: [
      smokeUser("rrssnas", "/home/rrssnas", join(runDirectory, "rrssnas-codex-home"), passwordHash),
      smokeUser("codex", "/home/codex", join(runDirectory, "codex-codex-home"), passwordHash),
    ],
  };
  await writeConfig(configPath, initialConfig, true);
  const config = await readRuntimeBrokerConfig(configPath);
  const broker = await createRuntimeBrokerServer({
    socketPath: join(runDirectory, "runtime-broker.sock"),
    config,
    createRuntime: (user) => createRuntime(user),
  });
  let web: ChildProcess | null = null;
  let browser: CdpBrowser | null = null;
  const reloads: string[] = [];
  const stopWatching = watchRuntimeBrokerConfig({
    path: configPath,
    debounceMs: 50,
    load: () => readRuntimeBrokerConfig(configPath),
    apply: async (next) => {
      broker.reload(next, (user) => createRuntime(user));
      reloads.push("success");
    },
    onError: (error) => reloads.push(`error:${error.message}`),
  });

  try {
    const port = await findAvailablePort();
    web = startWeb(port, broker.socketPath, runDirectory);
    await waitForHttp(`http://127.0.0.1:${port}/login`, 120_000);
    progress(`生产 Web 已启动：http://127.0.0.1:${port}`);

    browser = await CdpBrowser.connect(cdpEndpoint);
    const rrssnas = await browser.createPage();
    const codex = await browser.createPage();
    const baseUrl = `http://192.168.3.12:${port}`;
    await loginInBrowser(rrssnas, baseUrl, "rrssnas@example.test");
    progress("rrssnas Chrome 页面登录完成");
    await loginInBrowser(codex, baseUrl, "codex@example.test");
    progress("codex Chrome 页面登录完成");

    const rrssnasIdentity = await readIdentity(rrssnas);
    const codexIdentity = await readIdentity(codex);
    assertIdentity(rrssnasIdentity, "rrssnas", "/home/rrssnas", join(runDirectory, "rrssnas-codex-home"));
    assertIdentity(codexIdentity, "codex", "/home/codex", join(runDirectory, "codex-codex-home"));
    await waitFor(() => runtimeStates.size === 2 && [...runtimeStates.values()].every((state) => state.createCount === 1));
    progress("双账号身份与隔离 CODEX_HOME 验证完成");

    const rrssnasSecond = await browser.createPage(rrssnas.contextId, `${baseUrl}/chat`);
    await rrssnasSecond.waitFor("location.pathname === '/chat'", 30_000);
    await waitFor(() => (runtimeStates.get("rrssnas")?.peers.size ?? 0) >= 2);
    if (runtimeStates.get("rrssnas")?.createCount !== 1) throw new Error("同用户浏览器没有复用 runtime");
    progress("rrssnas 第二页面复用 runtime 验证完成");

    await sendMarker(rrssnas, "rrssnas-marker");
    await sendMarker(codex, "codex-marker");
    await waitFor(() => (
      runtimeStates.get("rrssnas")?.markers.includes("rrssnas-marker") === true
      && runtimeStates.get("codex")?.markers.includes("codex-marker") === true
    ));
    if (runtimeStates.get("rrssnas")?.markers.includes("codex-marker")) throw new Error("codex 消息串入 rrssnas runtime");
    if (runtimeStates.get("codex")?.markers.includes("rrssnas-marker")) throw new Error("rrssnas 消息串入 codex runtime");
    progress("跨用户 WebSocket 消息隔离验证完成");

    const alt = await browser.createPage();
    await writeFile(configPath, "{ invalid json\n");
    await waitFor(() => reloads.some((item) => item.startsWith("error:")), 5_000);
    if (await loginStatus(alt, baseUrl, "rrssnas-alt@example.test", altPassword) !== 401) {
      throw new Error("无效配置错误地新增了用户");
    }
    await sendMarker(rrssnas, "rrssnas-after-invalid-config");
    await waitFor(() => runtimeStates.get("rrssnas")?.markers.includes("rrssnas-after-invalid-config") === true);
    if (runtimeStates.get("rrssnas")?.createCount !== 1 || runtimeStates.get("codex")?.createCount !== 1) {
      throw new Error("无效配置中断了现有 runtime");
    }

    const altUser = smokeUser(
      "rrssnas-alt",
      "/home/rrssnas",
      join(runDirectory, "rrssnas-alt-codex-home"),
      altPasswordHash,
      "rrssnas",
    );
    const addReloadCount = reloads.length;
    await writeConfig(configPath, { ...initialConfig, users: [...initialConfig.users, altUser] });
    await waitFor(() => reloads.length > addReloadCount && reloads.at(-1) === "success", 5_000);
    if (await loginStatus(alt, baseUrl, "rrssnas-alt@example.test", password) !== 401) {
      throw new Error("新增账号错误接受了原账号密码");
    }
    const primaryCredentialProbe = await browser.createPage();
    if (await loginStatus(primaryCredentialProbe, baseUrl, "rrssnas@example.test", altPassword) !== 401) {
      throw new Error("原账号错误接受了新增账号密码");
    }
    await loginInBrowser(alt, baseUrl, "rrssnas-alt@example.test", altPassword);
    const altIdentity = await readIdentity(alt);
    assertIdentity(
      altIdentity,
      "rrssnas-alt",
      "/home/rrssnas",
      join(runDirectory, "rrssnas-alt-codex-home"),
      "rrssnas",
    );

    const nextCodexHome = join(runDirectory, "codex-next-codex-home");
    const nextCodex = smokeUser("codex", "/home/codex", nextCodexHome, passwordHash);
    const changeReloadCount = reloads.length;
    await writeConfig(configPath, {
      ...initialConfig,
      users: [initialConfig.users[0], nextCodex, altUser],
    });
    await waitFor(() => reloads.length > changeReloadCount && reloads.at(-1) === "success", 5_000);
    await waitFor(() => runtimeStates.get("codex")?.closed === true, 5_000);
    if (runtimeStates.get("rrssnas")?.createCount !== 1 || runtimeStates.get("rrssnas")?.closed) {
      throw new Error("codex 配置变化影响了未变化用户 runtime");
    }
    await loginInBrowser(codex, baseUrl, "codex@example.test");
    await waitFor(() => runtimeStates.get("codex")?.createCount === 2, 5_000);
    const codexNextIdentity = await readIdentity(codex);
    assertIdentity(codexNextIdentity, "codex", "/home/codex", nextCodexHome);
    progress("配置热加载无效回退、新增用户和单用户替换验证完成");

    await logoutAndLeave(rrssnas);
    await delay(400);
    progress(`rrssnas 第一页面退出后：${runtimeSummary()}`);
    if (runtimeStates.get("rrssnas")?.closed) throw new Error("同用户仍有浏览器连接时 runtime 被提前关闭");
    await logoutAndLeave(rrssnasSecond);
    await logoutAndLeave(codex);
    await logoutAndLeave(alt);
    progress(`全部页面退出后：${runtimeSummary()}`);
    await waitFor(() => [...runtimeStates.values()].every((state) => state.closed), 5_000);
    progress("退出与 runtime 回收验证完成");

    const result = {
      passed: true,
      runDirectory,
      users: [rrssnasIdentity, codexIdentity, altIdentity, codexNextIdentity],
      runtimes: Object.fromEntries([...runtimeStates].map(([id, state]) => [id, {
        createCount: state.createCount,
        markers: state.markers,
        closed: state.closed,
      }])),
      rootUidVerified: false,
      hotReload: {
        invalidConfigKeptCurrentRuntime: true,
        addedUserLoggedInWithoutRestart: true,
        sameOsUserDifferentCredentialsHotLoaded: true,
        crossedPasswordsRejected: true,
        changedUserRuntimeReplaced: true,
        unchangedUserStayedOnline: true,
      },
      note: "真实 Chrome 已验证配置热加载与隔离；未使用真实 Codex Home，未验证 sudo/UID 切换。",
    };
    await writeFile(join(runDirectory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await writeFile(join(runDirectory, "error.json"), `${JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      runtimes: runtimeSnapshot(),
    }, null, 2)}\n`, { flag: "wx" });
    throw error;
  } finally {
    stopWatching();
    await browser?.close();
    if (web) await stopProcess(web);
    await broker.close();
  }
}

function smokeUser(
  id: string,
  home: string,
  codexHome: string,
  passwordHash: string,
  osUser = id,
): Record<string, unknown> {
  return {
    id,
    email: `${id}@example.test`,
    passwordHash,
    osUser,
    home,
    codexHome,
    cwd: home,
    role: "admin",
  };
}

type RuntimeState = {
  createCount: number;
  peers: Set<AppServerPeer>;
  markers: string[];
  closed: boolean;
};

function createRuntime(user: RuntimeBrokerUserConfig): UserRuntimeServer {
  const state: RuntimeState = {
    createCount: (runtimeStates.get(user.id)?.createCount ?? 0) + 1,
    peers: new Set(),
    markers: [],
    closed: false,
  };
  runtimeStates.set(user.id, state);
  return {
    pid: 40_000 + runtimeStates.size,
    attach: (peer) => state.peers.add(peer),
    detach: (peer) => state.peers.delete(peer),
    handleClientMessage: (peer, message) => handleFixtureMessage(user, state, peer, message),
    broadcast: (message, excludedPeer) => {
      const serialized = JSON.stringify(message);
      for (const peer of state.peers) if (peer !== excludedPeer) peer.send(serialized);
    },
    close: () => {
      state.closed = true;
      for (const peer of state.peers) peer.close();
      state.peers.clear();
    },
  };
}

function handleFixtureMessage(
  user: RuntimeBrokerUserConfig,
  state: RuntimeState,
  peer: AppServerPeer,
  message: JsonRpcMessage,
): void {
  if (!("method" in message) || message.id === undefined) return;
  const request = message as JsonRpcRequest;
  if (request.method === "smoke/identity") {
    const marker = readMarker(request.params);
    if (marker) state.markers.push(marker);
  }
  peer.send(JSON.stringify({ id: request.id, result: fixtureResult(user, request.method) }));
}

function fixtureResult(user: RuntimeBrokerUserConfig, method: string): unknown {
  if (method === "initialize") {
    return {
      userAgent: `codex-web-smoke/${user.id}`,
      codexHome: user.codexHome,
      platformFamily: "unix",
      platformOs: "linux",
    };
  }
  if (method === "model/list") return { data: [], nextCursor: null };
  if (method === "account/read") return { account: null, requiresOpenaiAuth: false };
  if (method === "thread/list") return { data: [], nextCursor: null, backwardsCursor: null };
  if (method === "config/read") return { config: {}, origins: {}, layers: null };
  return { ok: true, userId: user.id };
}

function readMarker(params: unknown): string | null {
  if (!params || typeof params !== "object" || !("marker" in params)) return null;
  const marker = (params as { marker?: unknown }).marker;
  return typeof marker === "string" ? marker : null;
}

function startWeb(port: number, socketPath: string, runDirectory: string): ChildProcess {
  const child = spawn(process.execPath, [resolve("dist/cli/codex-web.mjs"), "--host", "0.0.0.0", "--port", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_HOME: join(runDirectory, "web-state"),
      CODEX_WEB_RUNTIME_BROKER_SOCKET: socketPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  return child;
}

async function loginInBrowser(
  client: CdpClient,
  baseUrl: string,
  email: string,
  loginPassword = password,
): Promise<void> {
  await client.navigate(`${baseUrl}/login`);
  await client.waitFor("Boolean(document.querySelector('[data-testid=web-login-form]'))", 30_000);
  const status = await client.evaluate<number>(`fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(loginPassword)} }),
  }).then((response) => response.status)`);
  if (status !== 200) throw new Error(`${email} 浏览器登录失败：HTTP ${status}`);
  await client.navigate(`${baseUrl}/chat`);
  await client.waitFor("location.pathname === '/chat'", 30_000);
}

async function loginStatus(
  client: CdpClient,
  baseUrl: string,
  email: string,
  loginPassword = password,
): Promise<number> {
  await client.navigate(`${baseUrl}/login`);
  await client.waitFor("Boolean(document.querySelector('[data-testid=web-login-form]'))", 30_000);
  return await client.evaluate<number>(`fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(loginPassword)} }),
  }).then((response) => response.status)`);
}

type BrowserIdentity = {
  bridgeUrl: string;
  homeDirectory: string;
  user: { id: string; osUser: string; codexHome: string };
};

async function readIdentity(client: CdpClient): Promise<BrowserIdentity> {
  return await client.evaluate<BrowserIdentity>(`fetch('/api/codex/bridge-url', { cache: 'no-store' }).then((response) => response.json())`);
}

function assertIdentity(
  identity: BrowserIdentity,
  id: string,
  home: string,
  codexHome: string,
  osUser = id,
): void {
  if (identity.bridgeUrl !== "/codex-bridge") throw new Error(`${id} bridge URL 不是同源路径`);
  if (identity.user.id !== id || identity.user.osUser !== osUser) throw new Error(`${id} broker 身份不匹配`);
  if (identity.homeDirectory !== home || identity.user.codexHome !== codexHome) {
    throw new Error(`${id} home 或隔离 CODEX_HOME 不匹配`);
  }
}

async function writeConfig(path: string, value: object, create = false): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    ...(create ? { flag: "wx" as const } : {}),
    mode: 0o600,
  });
}

async function sendMarker(client: CdpClient, marker: string): Promise<void> {
  await client.evaluate(`(async () => {
    const config = await fetch('/api/codex/bridge-url', { cache: 'no-store' }).then((response) => response.json());
    const url = new URL(config.bridgeUrl, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url.href);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    window.__codexWebSmokeSockets = window.__codexWebSmokeSockets || [];
    window.__codexWebSmokeSockets.push(socket);
    socket.send(JSON.stringify({ id: 991, method: 'smoke/identity', params: { marker: ${JSON.stringify(marker)} } }));
  })()`);
}

async function logoutAndLeave(client: CdpClient): Promise<void> {
  await client.evaluate(`(async () => {
    for (const socket of window.__codexWebSmokeSockets || []) socket.close();
    window.__codexWebSmokeSockets = [];
    await fetch('/api/auth/logout', { method: 'POST' });
    window.dispatchEvent(new Event('codex-web:logout'));
    location.href = '/login';
  })()`);
  await client.waitFor("location.pathname === '/login'", 30_000);
  await client.waitFor("Boolean(document.querySelector('[data-testid=web-login-form]'))", 30_000);
}

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法分配 smoke 端口");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // 服务尚未监听。
    }
    await delay(200);
  }
  throw new Error(`等待 Web 服务超时：${url}`);
}

export class CdpBrowser {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly pages = new Set<CdpClient>();
  private readonly contexts = new Set<string>();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => this.handleMessage(data.toString("utf8")));
    socket.once("close", () => this.rejectAll(new Error("CDP WebSocket 已关闭")));
    socket.once("error", (error) => this.rejectAll(error));
  }

  static async connect(endpoint: string): Promise<CdpBrowser> {
    const response = await fetch(`${endpoint}/json/version`);
    if (!response.ok) throw new Error(`读取 CDP Browser 端点失败：HTTP ${response.status}`);
    const version = await response.json() as { webSocketDebuggerUrl?: string };
    if (!version.webSocketDebuggerUrl) throw new Error("CDP Browser 缺少 WebSocket URL");
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new CdpBrowser(socket);
  }

  async createPage(existingContextId?: string, initialUrl = "about:blank"): Promise<CdpClient> {
    let contextId = existingContextId;
    if (!contextId) {
      const context = await this.request<{ browserContextId: string }>("Target.createBrowserContext");
      contextId = context.browserContextId;
      this.contexts.add(contextId);
    }
    const target = await this.request<{ targetId: string }>("Target.createTarget", {
      url: initialUrl,
      browserContextId: contextId,
    });
    const attached = await this.request<{ sessionId: string }>("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    const page = new CdpClient(this, attached.sessionId, target.targetId, contextId);
    this.pages.add(page);
    return page;
  }

  request<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async close(): Promise<void> {
    for (const page of this.pages) {
      await this.request("Target.closeTarget", { targetId: page.targetId }).catch(() => undefined);
    }
    for (const browserContextId of this.contexts) {
      await this.request("Target.disposeBrowserContext", { browserContextId }).catch(() => undefined);
    }
    this.socket.close();
  }

  private handleMessage(text: string): void {
    const message = JSON.parse(text) as { id?: number; result?: unknown; error?: { message?: string } };
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message ?? "CDP 请求失败"));
    else pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export class CdpClient {
  constructor(
    private readonly browser: CdpBrowser,
    private readonly sessionId: string,
    readonly targetId: string,
    readonly contextId: string,
  ) {}

  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.browser.request<T>(method, params, this.sessionId);
  }

  async navigate(url: string): Promise<void> {
    await this.request("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'", 120_000);
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.request<{ result?: { value?: T }; exceptionDetails?: { text?: string } }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? "浏览器表达式执行失败");
    return response.result?.value as T;
  }

  async waitFor(expression: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await this.evaluate<boolean>(expression)) return;
      } catch {
        // 页面导航期间执行上下文会短暂失效。
      }
      await delay(100);
    }
    throw new Error(`等待浏览器条件超时：${expression}`);
  }

}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(10_000),
  ]);
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("等待 smoke 状态超时");
    await delay(20);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function progress(message: string): void {
  console.log(`[multi-user-browser-smoke] ${message}`);
}

function runtimeSnapshot(): Record<string, unknown> {
  return Object.fromEntries([...runtimeStates].map(([id, state]) => [id, {
    createCount: state.createCount,
    peers: state.peers.size,
    markers: state.markers,
    closed: state.closed,
  }]));
}

function runtimeSummary(): string {
  return JSON.stringify(runtimeSnapshot());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
