import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { chmod, chown, mkdir, readFile, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const mode = process.argv[2];
const runDirectory = process.env.CODEX_WEB_MACOS_SMOKE_DIR;
const cli = process.env.CODEX_WEB_MACOS_SMOKE_CLI;
const codexCommand = process.env.CODEX_WEB_MACOS_SMOKE_CODEX ?? "/usr/local/bin/codex";
const chromeCommand = process.env.CODEX_WEB_MACOS_SMOKE_CHROME
  ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const regularUserName = process.env.CODEX_WEB_MACOS_SMOKE_USER ?? "wr";
const runId = process.env.CODEX_WEB_MACOS_SMOKE_RUN_ID ?? "default";
const password = `macos-browser-smoke-${Date.now()}`;

if (process.platform !== "darwin") throw new Error("macOS 浏览器 smoke 只能在 macOS 上运行");
if (mode !== "single" && mode !== "multi") throw new Error("用法：node scripts/macos-browser-smoke.mjs <single|multi>");
if (!runDirectory || !runDirectory.startsWith("/private/tmp/")) throw new Error("必须设置 /private/tmp 下的隔离 CODEX_WEB_MACOS_SMOKE_DIR");
if (!cli || !resolve(cli).startsWith(`${runDirectory}/`)) throw new Error("必须设置隔离目录内的 CODEX_WEB_MACOS_SMOKE_CLI");
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("CODEX_WEB_MACOS_SMOKE_RUN_ID 格式无效");

const regularUser = lookupUser(regularUserName);
const rootUser = lookupUser("root");
const children = [];
let browser;

async function main() {
  try {
    const result = mode === "single" ? await runSingle() : await runMulti();
    const resultPath = join(runDirectory, `${mode}-${runId}-result.json`);
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    if (process.getuid() === 0) await chown(resultPath, regularUser.uid, regularUser.gid);
    console.log(JSON.stringify({ ...result, resultPath }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children.reverse()) await stopProcess(child);
  }
}

async function runSingle() {
  if (process.getuid() !== regularUser.uid) throw new Error(`single 模式必须由 ${regularUser.name} 运行`);
  const root = join(runDirectory, `single-${runId}`);
  const codexHome = join(root, "codex-home");
  const cwd = join(root, "workspace");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  const port = await findAvailablePort();
  const web = start(cli, ["serve", "--host", "127.0.0.1", "--port", String(port)], {
    cwd,
    env: {
      ...process.env,
      HOME: regularUser.home,
      USER: regularUser.name,
      LOGNAME: regularUser.name,
      PATH: "/usr/local/bin:/usr/bin:/bin",
      CODEX_HOME: codexHome,
      CODEX_WEB_LOGIN_EMAIL: "single@example.test",
      CODEX_WEB_LOGIN_PASSWORD: password,
      CODEX_WEB_SESSION_SECRET: "macos-single-browser-smoke-session-secret-2026",
      NODE_ENV: "production",
      RUST_LOG: "warn",
    },
  }, "single-web");
  await waitForHttp(`http://127.0.0.1:${port}/login`, 120_000, web);
  browser = await startChrome(join(root, "chrome-profile"));
  const page = await browser.createPage();
  const baseUrl = `http://127.0.0.1:${port}`;
  await login(page, baseUrl, "single@example.test", password);
  const identity = await readIdentity(page);
  assertIdentity(identity, "single@example.test", regularUser.name, regularUser.home, codexHome);
  const bootstrap = await bootstrapAppServer(page);
  if (bootstrap.initialize.codexHome !== codexHome) throw new Error("单用户 app-server 使用了错误 CODEX_HOME");
  if (!Array.isArray(bootstrap.models.data) || bootstrap.models.data.length === 0) throw new Error("单用户 model/list 没有返回模型");
  const appServerPid = await waitForLoggedAppServerPid(web);
  const appServerUid = processUid(appServerPid);
  if (appServerUid !== regularUser.uid) throw new Error("单用户 app-server UID 不匹配");
  await closeAppServerSocket(page);
  return {
    passed: true,
    mode,
    browser: "Google Chrome headless CDP",
    user: regularUser.name,
    codexHome,
    cwd,
    appServer: { pid: appServerPid, uid: appServerUid },
    modelCount: bootstrap.models.data.length,
    accountRead: true,
    realCodexHomeUsed: false,
  };
}

async function runMulti() {
  if (process.getuid() !== 0) throw new Error("multi 模式必须由 root 运行");
  const root = join(runDirectory, `multi-${runId}`);
  const socketDirectory = join(root, "run");
  const socketPath = join(socketDirectory, "runtime-broker.sock");
  const webState = join(root, "web-state");
  const chromeProfile = join(root, "chrome-profile");
  const users = [
    runtimeUser(regularUser, root, false),
    runtimeUser(rootUser, root, true),
  ];
  await mkdir(socketDirectory, { recursive: true, mode: 0o750 });
  await chown(root, 0, regularUser.gid);
  await chmod(root, 0o750);
  await mkdir(webState, { recursive: true, mode: 0o700 });
  await mkdir(chromeProfile, { recursive: true, mode: 0o700 });
  await chown(socketDirectory, 0, regularUser.gid);
  await chown(webState, regularUser.uid, regularUser.gid);
  await chown(chromeProfile, regularUser.uid, regularUser.gid);
  for (const user of users) {
    await mkdir(user.codexHome, { recursive: true, mode: 0o700 });
    await mkdir(user.cwd, { recursive: true, mode: 0o700 });
    await chown(user.codexHome, user.record.uid, user.record.gid);
    await chown(user.cwd, user.record.uid, user.record.gid);
  }
  const passwordHash = hashPassword(password);
  const configPath = join(root, "users.json");
  await writeFile(configPath, `${JSON.stringify({
    version: 1,
    sessionSecret: "macos-multi-browser-smoke-session-secret-2026",
    sessionMaxAgeSeconds: 3600,
    disconnectGraceMs: 800,
    allowRootRuntime: true,
    codexCommand,
    setprivCommand: "/usr/bin/false",
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      passwordHash,
      osUser: user.record.name,
      home: user.record.home,
      codexHome: user.codexHome,
      cwd: user.cwd,
      role: user.allowRoot ? "admin" : "user",
      enabled: true,
      allowRoot: user.allowRoot,
      env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    })),
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 });

  const runtime = start(cli, ["runtime", "serve", "--config", configPath, "--socket", socketPath], {
    cwd: root,
    gid: regularUser.gid,
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", NODE_ENV: "production" },
  }, "runtime");
  await waitForSocket(socketPath, runtime, 15_000);
  const port = await findAvailablePort();
  const web = start("/usr/bin/sudo", [
    "-n", "-H", "-u", regularUser.name, "--", "/usr/bin/env", "-i",
    `HOME=${regularUser.home}`,
    `USER=${regularUser.name}`,
    `LOGNAME=${regularUser.name}`,
    `SHELL=${regularUser.shell}`,
    "PATH=/usr/local/bin:/usr/bin:/bin",
    `CODEX_HOME=${webState}`,
    `CODEX_WEB_RUNTIME_BROKER_SOCKET=${socketPath}`,
    "NODE_ENV=production",
    "RUST_LOG=warn",
    cli, "serve", "--host", "127.0.0.1", "--port", String(port),
  ], { cwd: webState, env: { PATH: "/usr/local/bin:/usr/bin:/bin" } }, "multi-web");
  await waitForHttp(`http://127.0.0.1:${port}/login`, 120_000, web);
  browser = await startChrome(chromeProfile, true);
  const regularPage = await browser.createPage();
  const rootPage = await browser.createPage();
  const baseUrl = `http://127.0.0.1:${port}`;
  await login(regularPage, baseUrl, users[0].email, password);
  await login(rootPage, baseUrl, users[1].email, password);
  assertIdentity(await readIdentity(regularPage), users[0].id, regularUser.name, regularUser.home, users[0].codexHome);
  assertIdentity(await readIdentity(rootPage), users[1].id, rootUser.name, rootUser.home, users[1].codexHome);
  const regularBootstrap = await bootstrapAppServer(regularPage);
  const rootBootstrap = await bootstrapAppServer(rootPage);
  assertCodexHome(regularBootstrap, users[0].codexHome, users[0].id);
  assertCodexHome(rootBootstrap, users[1].codexHome, users[1].id);

  const regularRuntime = await probeRuntime(socketPath, users[0].email, password);
  const rootRuntime = await probeRuntime(socketPath, users[1].email, password);
  await assertRuntimeUser(regularRuntime, regularUser.uid, users[0].id);
  await assertRuntimeUser(rootRuntime, rootUser.uid, users[1].id);
  if (regularRuntime.pid === rootRuntime.pid) throw new Error("不同用户复用了同一个 runtime PID");
  const regularSecond = await browser.createPage(regularPage.contextId, `${baseUrl}/chat`);
  await regularSecond.waitFor("location.pathname === '/chat'", 30_000);
  const secondBootstrap = await bootstrapAppServer(regularSecond);
  assertCodexHome(secondBootstrap, users[0].codexHome, `${users[0].id} 第二页面`);
  const regularSecondRuntime = await probeRuntime(socketPath, users[0].email, password);
  if (regularSecondRuntime.pid !== regularRuntime.pid) throw new Error("同用户第二页面启动了额外 runtime");

  await regularPage.close();
  await delay(1_200);
  if (!processExists(regularRuntime.pid)) throw new Error("同用户第二页面在线时 regular runtime 被关闭");
  await regularSecond.close();
  await waitFor(() => !processExists(regularRuntime.pid), 10_000, "regular runtime 退出");
  if (!processExists(rootRuntime.pid)) throw new Error("regular runtime 退出影响了 root runtime");
  await rootPage.close();
  await waitFor(() => !processExists(rootRuntime.pid), 10_000, "root runtime 退出");

  return {
    passed: true,
    mode,
    browser: "Google Chrome headless CDP",
    users: users.map(({ id, record, codexHome, cwd }) => ({ id, osUser: record.name, uid: record.uid, codexHome, cwd })),
    appServers: { [users[0].id]: regularRuntime, [users[1].id]: rootRuntime },
    sameUserRuntimeReused: true,
    crossUserIsolation: true,
    runtimesStoppedAfterLastPage: true,
    modelCounts: { [users[0].id]: regularBootstrap.models.data.length, [users[1].id]: rootBootstrap.models.data.length },
    realCodexHomeUsed: false,
  };
}

function runtimeUser(record, root, allowRoot) {
  const id = allowRoot ? "root-smoke" : `${record.name}-smoke`;
  return {
    id,
    email: `${id}@example.test`,
    record,
    codexHome: join(root, `${id}-codex-home`),
    cwd: join(root, `${id}-workspace`),
    allowRoot,
  };
}

function lookupUser(name) {
  const output = execFileSync("/usr/bin/dscacheutil", ["-q", "user", "-a", "name", name], { encoding: "utf8" });
  const values = Object.fromEntries(output.split(/\r?\n/).map((line) => {
    const separator = line.indexOf(":");
    return separator > 0 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] : ["", ""];
  }).filter(([key]) => key));
  const uid = Number(values.uid);
  const gid = Number(values.gid);
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || !values.dir || !values.shell) throw new Error(`无法解析 macOS 用户：${name}`);
  return { name, uid, gid, home: values.dir, shell: values.shell };
}

function hashPassword(value) {
  const result = spawnSync(cli, ["runtime", "hash-password"], { input: value, encoding: "utf8", env: { PATH: "/usr/local/bin:/usr/bin:/bin" } });
  if (result.status !== 0) throw new Error(`生成 smoke 密码哈希失败：${result.stderr}`);
  return result.stdout.trim();
}

function start(command, args, options, name) {
  const child = spawn(command, args, { ...options, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.smokeOutput = "";
  child.stdout.on("data", (chunk) => {
    child.smokeOutput += chunk.toString("utf8");
    process.stdout.write(`[${name}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    child.smokeOutput += chunk.toString("utf8");
    process.stderr.write(`[${name}] ${chunk}`);
  });
  children.push(child);
  return child;
}

async function startChrome(profile, asRegularUser = false) {
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "about:blank",
  ];
  const chrome = asRegularUser
    ? start("/usr/bin/sudo", ["-n", "-H", "-u", regularUser.name, "--", chromeCommand, ...args], { env: { PATH: "/usr/local/bin:/usr/bin:/bin" } }, "chrome")
    : start(chromeCommand, args, { env: process.env }, "chrome");
  const activePort = join(profile, "DevToolsActivePort");
  await waitFor(async () => {
    try { return (await readFile(activePort, "utf8")).trim().length > 0; } catch { return false; }
  }, 30_000, "Chrome CDP 端口");
  const port = (await readFile(activePort, "utf8")).split(/\r?\n/)[0];
  const connected = await CdpBrowser.connect(`http://127.0.0.1:${port}`);
  connected.chrome = chrome;
  return connected;
}

async function login(page, baseUrl, email, loginPassword) {
  await page.navigate(`${baseUrl}/login`);
  await page.waitFor("Boolean(document.querySelector('[data-testid=web-login-form]'))", 30_000);
  const status = await page.evaluate(`fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(loginPassword)} }),
  }).then((response) => response.status)`);
  if (status !== 200) throw new Error(`${email} 登录失败：HTTP ${status}`);
  await page.navigate(`${baseUrl}/chat`);
  await page.waitFor("location.pathname === '/chat'", 30_000);
}

async function readIdentity(page) {
  return await page.evaluate("fetch('/api/codex/bridge-url', { cache: 'no-store' }).then((response) => response.json())");
}

function assertIdentity(identity, id, osUser, home, codexHome) {
  const bridgeUrl = new URL(identity.bridgeUrl, "http://127.0.0.1");
  if (bridgeUrl.pathname !== "/codex-bridge") throw new Error(`${id} bridge URL 不匹配`);
  if (identity.user?.id !== id || identity.user?.osUser !== osUser) throw new Error(`${id} Web 身份不匹配`);
  if (identity.homeDirectory !== home || identity.user?.codexHome !== codexHome) throw new Error(`${id} home/CODEX_HOME 不匹配`);
}

async function bootstrapAppServer(page) {
  return await page.evaluate(`(async () => {
    const config = await fetch('/api/codex/bridge-url', { cache: 'no-store' }).then((response) => response.json());
    const url = new URL(config.bridgeUrl, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url.href);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && pending.has(message.id)) {
        const callback = pending.get(message.id);
        pending.delete(message.id);
        message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result);
      }
    });
    let nextId = 1;
    const request = (method, params) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }));
    });
    const initialize = await request('initialize', {
      clientInfo: { name: 'codex_web_macos_smoke', title: 'Codex Web macOS Smoke', version: '0.0.0' },
      capabilities: { experimentalApi: true, requestAttestation: false, mcpServerOpenaiFormElicitation: false },
    });
    socket.send(JSON.stringify({ method: 'initialized' }));
    const [models, account] = await Promise.all([
      request('model/list', { includeHidden: false }),
      request('account/read', { refreshToken: false }),
    ]);
    window.__codexWebMacosSmokeSocket = socket;
    return { initialize, models, account };
  })()`);
}

function assertCodexHome(bootstrap, codexHome, label) {
  if (bootstrap.initialize.codexHome !== codexHome) throw new Error(`${label} app-server 使用了错误 CODEX_HOME`);
  if (!Array.isArray(bootstrap.models.data) || bootstrap.models.data.length === 0) throw new Error(`${label} model/list 没有返回模型`);
}

async function closeAppServerSocket(page) {
  await page.evaluate("window.__codexWebMacosSmokeSocket?.close(); window.__codexWebMacosSmokeSocket = undefined; true");
}

async function assertRuntimeUser(runtime, expectedUid, label) {
  await waitFor(() => Boolean(firstDescendantWithUid(runtime.pid, expectedUid)), 10_000, `${label} app-server UID`);
  const appServer = firstDescendantWithUid(runtime.pid, expectedUid);
  if (!appServer) throw new Error(`${label} app-server UID 不匹配`);
  runtime.launcherUid = processUid(runtime.pid);
  runtime.appServerPid = appServer.pid;
  runtime.appServerUid = appServer.uid;
}

async function waitForLoggedAppServerPid(web) {
  await waitFor(() => /Codex app-server PID: \d+/.test(web.smokeOutput), 30_000, "app-server PID 日志");
  return Number(web.smokeOutput.match(/Codex app-server PID: (\d+)/)[1]);
}

async function probeRuntime(socketPath, email, loginPassword) {
  const login = await brokerRequest(socketPath, { type: "login", email, password: loginPassword });
  if (!login.ok || login.type !== "login") throw new Error(`${email} broker 探测登录失败`);
  const attached = await brokerRequest(socketPath, { type: "attachRuntime", token: login.token });
  if (!attached.ok || attached.type !== "attached" || !Number.isSafeInteger(attached.pid)) {
    throw new Error(`${email} broker 未返回 runtime PID`);
  }
  return { pid: attached.pid };
}

function brokerRequest(socketPath, request) {
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const separator = buffer.indexOf("\n");
      if (separator < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, separator));
        socket.end();
        resolvePromise(response);
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

function processUid(pid) {
  const value = execFileSync("/bin/ps", ["-p", String(pid), "-o", "uid="], { encoding: "utf8" }).trim();
  const uid = Number(value);
  if (!Number.isSafeInteger(uid)) throw new Error(`无法读取进程 UID：${pid}`);
  return uid;
}

function firstDescendantWithUid(rootPid, expectedUid) {
  const output = execFileSync("/bin/ps", ["-axo", "pid=,ppid=,uid=,command="], { encoding: "utf8" });
  const rows = output.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), uid: Number(match[3]), command: match[4] } : null;
  }).filter(Boolean);
  const children = new Map();
  for (const row of rows) {
    const siblings = children.get(row.ppid) ?? [];
    siblings.push(row);
    children.set(row.ppid, siblings);
  }
  const root = rows.find((row) => row.pid === rootPid);
  if (!root) return null;
  const queue = [root];
  while (queue.length > 0) {
    const row = queue.shift();
    if (row.uid === expectedUid) return row;
    queue.push(...(children.get(row.pid) ?? []));
  }
  return null;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法分配端口");
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return address.port;
}

async function waitForHttp(url, timeoutMs, child) {
  await waitFor(async () => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Web 服务提前退出：${child.smokeOutput.trim()}`);
    try { return (await fetch(url, { redirect: "manual" })).status < 500; } catch { return false; }
  }, timeoutMs, `Web 服务 ${url}`);
}

async function waitForSocket(path, child, timeoutMs) {
  await waitFor(async () => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("runtime broker 提前退出");
    try {
      const { stdout } = await execFileAsync("/usr/bin/stat", ["-f", "%HT", path], { encoding: "utf8" });
      return stdout.trim() === "Socket";
    } catch { return false; }
  }, timeoutMs, "runtime broker socket");
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`等待超时：${label}`);
    await delay(100);
  }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    delay(10_000),
  ]);
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

class CdpBrowser {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.pages = new Set();
    this.contexts = new Set();
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("close", () => this.rejectAll(new Error("CDP WebSocket 已关闭")), { once: true });
  }

  static async connect(endpoint) {
    const response = await fetch(`${endpoint}/json/version`);
    if (!response.ok) throw new Error(`读取 CDP 端点失败：HTTP ${response.status}`);
    const version = await response.json();
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolvePromise, reject) => {
      socket.addEventListener("open", resolvePromise, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpBrowser(socket);
  }

  async createPage(existingContextId, initialUrl = "about:blank") {
    let contextId = existingContextId;
    if (!contextId) {
      contextId = (await this.request("Target.createBrowserContext")).browserContextId;
      this.contexts.add(contextId);
    }
    const { targetId } = await this.request("Target.createTarget", { url: initialUrl, browserContextId: contextId });
    const { sessionId } = await this.request("Target.attachToTarget", { targetId, flatten: true });
    const page = new CdpPage(this, sessionId, targetId, contextId);
    this.pages.add(page);
    return page;
  }

  request(method, params, sessionId) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}), ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async close() {
    for (const page of this.pages) await this.request("Target.closeTarget", { targetId: page.targetId }).catch(() => undefined);
    for (const contextId of this.contexts) await this.request("Target.disposeBrowserContext", { browserContextId: contextId }).catch(() => undefined);
    this.socket.close();
  }

  handleMessage(text) {
    const message = JSON.parse(text);
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

class CdpPage {
  constructor(browser, sessionId, targetId, contextId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.contextId = contextId;
  }

  request(method, params) {
    return this.browser.request(method, params, this.sessionId);
  }

  async close() {
    await this.browser.request("Target.closeTarget", { targetId: this.targetId });
  }

  async navigate(url) {
    await this.request("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'", 120_000);
  }

  async evaluate(expression) {
    const response = await this.request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? "浏览器表达式执行失败");
    return response.result?.value;
  }

  async waitFor(expression, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { if (await this.evaluate(expression)) return; } catch { /* 导航时执行上下文会短暂失效。 */ }
      await delay(100);
    }
    throw new Error(`等待浏览器条件超时：${expression}`);
  }
}

await main();
