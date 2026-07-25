import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";

import { WebSocketServer, type WebSocket } from "ws";

import { resolveTestCodexHome } from "../server/test-codex-home";
import { createSessionToken, WEB_AUTH_COOKIE, type WebAuthConfig } from "../server/web-auth";

const codexHome = resolveTestCodexHome();
process.env.CODEX_HOME = codexHome;
const threadId = "user-input-smoke-thread";
const webAuth: WebAuthConfig = {
  email: "smoke@codex-web.local",
  password: "smoke-password",
  sessionSecret: "codex-web-smoke-session-secret-2026",
};

async function main(): Promise<void> {
  const cdpBaseUrl = process.env.CODEX_WEB_CDP_URL ?? "http://192.168.3.12:45737";
  const publicHost = process.env.CODEX_WEB_PUBLIC_HOST ?? "192.168.3.12";
  const fake = await startFakeAppServer(publicHost);
  const appPort = await reservePort();
  const appUrl = `http://${publicHost}:${appPort}`;
  const next = startNext(appPort, fake.url);
  let target: { id: string; webSocketDebuggerUrl: string } | null = null;
  let cdp: CdpClient | null = null;

  try {
  await waitForHttp(`http://127.0.0.1:${appPort}/chat/${threadId}`, next);
  target = await createTarget(cdpBaseUrl);
  cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Network.enable");
  await cdp.call("Network.setCookie", {
    name: WEB_AUTH_COOKIE,
    value: createSessionToken(webAuth),
    url: appUrl,
  });
  await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const realDateNow = Date.now.bind(Date);
      Object.defineProperty(globalThis, "__codexSmokeNowOffsetMs", { value: 0, writable: true });
      Date.now = () => realDateNow() + globalThis.__codexSmokeNowOffsetMs;
    })();`,
  });
  await cdp.call("Page.navigate", { url: `${appUrl}/chat/${threadId}` });
  await waitFor(cdp, `document.body.innerText.includes("用户输入 Smoke") && document.querySelector("textarea") !== null`, 30_000);

  await assert(cdp, `document.querySelector('[data-testid="composer-file-changes"]') === null`, "普通路径不应显示文件变更汇总");
  fake.sendFileChanges();
  await waitFor(cdp, `document.querySelector('[data-testid="composer-file-changes"]')?.textContent?.includes("2 个文件已更改") === true`, 15_000);
  await assert(cdp, `document.querySelector('[data-testid="composer-file-changes"]')?.textContent?.includes("+3") === true`, "文件变更新增行统计错误");
  await assert(cdp, `document.querySelector('[data-testid="composer-file-changes"]')?.textContent?.includes("-1") === true`, "文件变更删除行统计错误");
  await click(cdp, '[data-testid="composer-file-changes"] > button');
  await click(cdp, '[data-testid="composer-file-changes"] [title="src/app.ts"]');
  await waitFor(cdp, `document.body.innerText.includes("+const nextValue = 2;")`, 15_000);

  fake.setGitStatus("partial");
  await cdp.call("Runtime.evaluate", { expression: `window.dispatchEvent(new CustomEvent("git-refresh"))` });
  await waitFor(cdp, `document.querySelector('[data-testid="composer-file-changes"]')?.textContent?.includes("1 个文件已更改") === true`, 15_000);
  await assert(cdp, `document.querySelector('[data-testid="composer-file-changes"]')?.textContent?.includes("+1") === true`, "部分提交后新增行统计错误");
  await assert(cdp, `document.querySelector('[data-testid="composer-file-changes"]')?.textContent?.includes("-0") === true`, "部分提交后删除行统计错误");
  await click(cdp, '[data-testid="composer-file-changes"] > button');
  await assert(cdp, `document.querySelector('[data-testid="composer-file-changes"] [title="src/new.ts"]') !== null`, "部分提交后应保留未提交文件");
  await assert(cdp, `document.querySelector('[data-testid="composer-file-changes"] [title="src/app.ts"]') === null`, "部分提交后不应保留已提交文件");

  fake.setGitStatus("clean");
  await cdp.call("Runtime.evaluate", { expression: `window.dispatchEvent(new CustomEvent("git-refresh"))` });
  await waitFor(cdp, `document.querySelector('[data-testid="composer-file-changes"]') === null`, 15_000);

  fake.setGitStatus("unavailable");
  await cdp.call("Runtime.evaluate", { expression: `window.dispatchEvent(new CustomEvent("git-refresh"))` });
  await waitFor(cdp, `document.querySelector('[data-testid="composer-file-changes"]')?.textContent?.includes("2 个文件已更改") === true`, 15_000);
  console.log("文件变更 UI smoke 通过：普通路径隐藏，未提交显示 2 文件，部分提交剩 1 文件，全部提交隐藏，Git 不可用时回退，右侧 diff 可见");

  fake.sendRequests();

  await waitForPrompt(cdp, "item/tool/requestUserInput");
  await assert(cdp, `document.querySelector('[data-testid="request-user-input-auto-resolution-countdown"]') === null`, "autoResolutionMs 为空时不应显示倒计时");
  await assert(cdp, `document.querySelector('[data-testid="request-user-input-submit"]')?.disabled === true`, "未回答时提交按钮应禁用");
  await clickButtonByText(cdp, "Production");
  await assert(cdp, `document.querySelector('[data-testid="request-user-input-submit"]')?.disabled === true`, "部分回答时提交按钮应保持禁用");
  await setInput(cdp, 'input[type="password"]', "smoke-secret");
  await click(cdp, '[data-testid="request-user-input-submit"]');
  expectEqual(await fake.waitForResponse("input-1"), {
    answers: {
      environment: { answers: ["Production"] },
      token: { answers: ["smoke-secret"] },
    },
  }, "requestUserInput response");

  await waitForPrompt(cdp, "mcpServer/elicitation/request");
  await assert(cdp, `document.querySelector('[data-testid="request-user-input-auto-resolution-countdown"]') === null`, "MCP 表单不应启用 requestUserInput 倒计时");
  await setInput(cdp, 'input[type="email"]', "smoke@example.com");
  await click(cdp, '[data-testid="mcp-elicitation-submit"]');
  expectEqual(await fake.waitForResponse("mcp-accept"), {
    action: "accept",
    content: { email: "smoke@example.com", enabled: false },
    _meta: { scenario: "accept" },
  }, "MCP accept response");

  await waitForPrompt(cdp, "mcpServer/elicitation/request");
  await click(cdp, '[data-testid="mcp-elicitation-decline"]');
  expectEqual(await fake.waitForResponse("mcp-decline"), {
    action: "decline",
    content: null,
    _meta: null,
  }, "MCP decline response");

  await waitForPrompt(cdp, "mcpServer/elicitation/request");
  await click(cdp, '[data-testid="mcp-elicitation-cancel"]');
  expectEqual(await fake.waitForResponse("mcp-cancel"), {
    action: "cancel",
    content: null,
    _meta: null,
  }, "MCP cancel response");

  await waitFor(cdp, `document.body.innerText.includes("smoke command")`, 15_000);
  await assert(cdp, `document.querySelector('[data-testid="app-server-request-prompt"]') === null`, "普通 approval 不应渲染用户输入表单");
  await click(cdp, '[data-testid="app-server-approval-deny"]');
  expectEqual(await fake.waitForResponse("approval-1"), { decision: "decline" }, "approval response");

  await waitForPrompt(cdp, "item/tool/requestUserInput");
  await assert(cdp, `document.querySelector('[data-testid="request-user-input-auto-resolution-countdown"]') === null`, "自动处理静默期不应显示倒计时");
  await advanceBrowserClock(cdp, 60_000);
  await waitFor(cdp, `document.querySelector('[data-testid="request-user-input-auto-resolution-countdown"]') !== null`, 3_000);
  await clickButtonByText(cdp, "Keep waiting");
  await waitFor(cdp, `document.querySelector('[data-testid="request-user-input-auto-resolution-countdown"]') === null`, 3_000);
  await advanceBrowserClock(cdp, 120_000);
  await delay(1_200);
  if (fake.hasResponse("auto-snooze")) throw new Error("用户交互后不应自动响应 requestUserInput");
  await click(cdp, '[data-testid="request-user-input-submit"]');
  expectEqual(await fake.waitForResponse("auto-snooze"), {
    answers: { action: { answers: ["Keep waiting"] } },
  }, "snoozed requestUserInput response");

  await waitForPrompt(cdp, "item/tool/requestUserInput");
  await assert(cdp, `document.querySelector('[data-testid="request-user-input-auto-resolution-countdown"]') === null`, "队列中的新请求应重新进入静默期");
  await advanceBrowserClock(cdp, 60_000);
  await waitFor(cdp, `document.querySelector('[data-testid="request-user-input-auto-resolution-countdown"]') !== null`, 3_000);
  await advanceBrowserClock(cdp, 60_000);
  expectEqual(await fake.waitForResponse("auto-submit"), { answers: {} }, "auto-resolved requestUserInput response");

  await waitFor(cdp, `document.querySelector('[data-testid="app-server-request-prompt"]') === null`, 15_000);
  await assert(cdp, `!document.body.innerText.includes("不应显示的跨线程问题")`, "跨 thread 请求不应显示");
  await assert(cdp, `document.querySelector("textarea")?.disabled === false`, "其他 thread 的 pending request 不应禁用当前 composer");

  console.log("用户输入 server request smoke 通过：表单响应、自动处理、FIFO、跨 thread、文件变更统计与右侧 diff 反例均符合预期");
  } finally {
    cdp?.close();
    if (target) await fetch(`${cdpBaseUrl}/json/close/${target.id}`).catch(() => undefined);
    await stopProcess(next);
    await fake.close();
  }
}

async function startFakeAppServer(publicHost: string): Promise<{
  url: string;
  sendRequests: () => void;
  sendFileChanges: () => void;
  setGitStatus: (status: GitSmokeStatus) => void;
  waitForResponse: (id: string) => Promise<unknown>;
  hasResponse: (id: string) => boolean;
  close: () => Promise<void>;
}> {
  const server = new WebSocketServer({ host: "0.0.0.0", port: 0 });
  await new Promise<void>((resolveListening, reject) => {
    server.once("listening", () => resolveListening());
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake app-server 未返回端口");

  let client: WebSocket | null = null;
  let gitStatus: GitSmokeStatus = "all";
  const responses = new Map<string, unknown>();
  const responseWaiters = new Map<string, (value: unknown) => void>();
  server.on("connection", (socket) => {
    client = socket;
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8")) as {
        id?: string | number;
        method?: string;
        params?: unknown;
        result?: unknown;
      };
      if (message.method && message.id !== undefined) {
        socket.send(JSON.stringify({ id: message.id, result: responseForMethod(message.method, message.params, gitStatus) }));
        return;
      }
      if (message.id !== undefined && "result" in message) {
        const id = String(message.id);
        responses.set(id, message.result);
        responseWaiters.get(id)?.(message.result);
        responseWaiters.delete(id);
      }
    });
  });

  return {
    url: `ws://${publicHost}:${address.port}`,
    sendRequests: () => {
      if (!client || client.readyState !== client.OPEN) throw new Error("fake app-server 尚未连接");
      for (const request of smokeRequests()) client.send(JSON.stringify(request));
    },
    sendFileChanges: () => {
      if (!client || client.readyState !== client.OPEN) throw new Error("fake app-server 尚未连接");
      for (const notification of fileChangeNotifications()) client.send(JSON.stringify(notification));
    },
    setGitStatus: (status) => {
      gitStatus = status;
    },
    waitForResponse: (id) => {
      if (responses.has(id)) return Promise.resolve(responses.get(id));
      return new Promise((resolveResponse, reject) => {
        const timeout = setTimeout(() => {
          responseWaiters.delete(id);
          reject(new Error(`等待 response 超时：${id}`));
        }, 15_000);
        responseWaiters.set(id, (value) => {
          clearTimeout(timeout);
          resolveResponse(value);
        });
      });
    },
    hasResponse: (id) => responses.has(id),
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

function fileChangeNotifications(): unknown[] {
  const changes = [
    {
      path: "src/app.ts",
      kind: { type: "update", move_path: null },
      diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n const value = 1;\n-const oldValue = 2;\n+const nextValue = 2;\n+export { nextValue };",
    },
    {
      path: "src/new.ts",
      kind: { type: "add" },
      diff: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1 @@\n+export {};",
    },
  ];
  return [
    { method: "turn/started", params: { threadId, turn: { id: "turn-file-smoke", status: "inProgress" } } },
    { method: "item/started", params: { threadId, turnId: "turn-file-smoke", item: { type: "fileChange", id: "patch-smoke", changes: [], status: "inProgress" } } },
    { method: "turn/diff/updated", params: { threadId, turnId: "turn-file-smoke", diff: changes.map((change) => change.diff).join("\n") } },
    { method: "item/fileChange/patchUpdated", params: { threadId, turnId: "turn-file-smoke", itemId: "patch-smoke", changes } },
  ];
}

type GitSmokeStatus = "all" | "partial" | "clean" | "unavailable";

function responseForMethod(method: string, params: unknown, gitStatus: GitSmokeStatus): unknown {
  const thread = smokeThread();
  switch (method) {
    case "initialize":
      return { codexHome, platformFamily: "unix" };
    case "model/list":
      return { data: [], nextCursor: null };
    case "account/read":
      return { account: null, requiresOpenaiAuth: false };
    case "thread/list":
      return { data: [thread], nextCursor: null };
    case "config/read":
      return { config: {}, origins: {}, layers: null };
    case "thread/read":
      return { thread };
    case "thread/resume":
      return {
        thread,
        model: "gpt-5.5",
        modelProvider: "openai",
        serviceTier: null,
        cwd: process.cwd(),
        instructionSources: [],
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: { type: "workspaceWrite", writableRoots: [process.cwd()], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
        reasoningEffort: "medium",
      };
    case "thread/turns/list":
      return { data: [], nextCursor: null, backwardsCursor: null };
    case "fs/readDirectory":
      return { entries: [] };
    case "command/exec": {
      const command = params && typeof params === "object" && Array.isArray((params as { command?: unknown }).command)
        ? (params as { command: string[] }).command
        : [];
      if (gitStatus === "unavailable") return { exitCode: 128, stdout: "", stderr: "not a git repository" };
      if (command.includes("rev-parse")) return { exitCode: 0, stdout: `${process.cwd()}\n`, stderr: "" };
      if (command.includes("status")) {
        const stdout = gitStatus === "all"
          ? " M src/app.ts\0?? src/new.ts\0"
          : gitStatus === "partial"
            ? "?? src/new.ts\0"
            : "";
        return { exitCode: 0, stdout, stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "unsupported fake command" };
    }
    default:
      return {};
  }
}

function smokeThread() {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: threadId,
    sessionId: threadId,
    forkedFromId: null,
    parentThreadId: null,
    preview: "用户输入 Smoke",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: now,
    updatedAt: now,
    recencyAt: now,
    status: { type: "idle" },
    path: null,
    cwd: process.cwd(),
    cliVersion: "smoke",
    source: "cli",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "用户输入 Smoke",
    turns: [],
  };
}

function smokeRequests(): unknown[] {
  return [
    {
      id: "other-thread",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "other-thread",
        turnId: "other-turn",
        itemId: "other-item",
        autoResolutionMs: null,
        questions: [{ id: "hidden", header: "隐藏", question: "不应显示的跨线程问题", isOther: true, isSecret: false, options: null }],
      },
    },
    {
      id: "input-1",
      method: "item/tool/requestUserInput",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "input-item",
        autoResolutionMs: null,
        questions: [
          { id: "environment", header: "Environment", question: "Choose an environment", isOther: true, isSecret: false, options: [{ label: "Production", description: "Live environment" }] },
          { id: "token", header: "Token", question: "Enter the token", isOther: true, isSecret: true, options: null },
        ],
      },
    },
    {
      id: "mcp-accept",
      method: "mcpServer/elicitation/request",
      params: {
        threadId,
        turnId: "turn-1",
        serverName: "smoke-mcp",
        mode: "form",
        message: "Enter MCP data",
        _meta: { scenario: "accept" },
        requestedSchema: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", title: "Email", format: "email" },
            enabled: { type: "boolean", title: "Enabled", default: false },
          },
        },
      },
    },
    {
      id: "mcp-decline",
      method: "mcpServer/elicitation/request",
      params: { threadId, turnId: "turn-1", serverName: "smoke-mcp", mode: "form", message: "Decline this request", _meta: { ignored: true }, requestedSchema: { type: "object", properties: {} } },
    },
    {
      id: "mcp-cancel",
      method: "mcpServer/elicitation/request",
      params: { threadId, turnId: "turn-1", serverName: "smoke-mcp", mode: "form", message: "Cancel this request", _meta: { ignored: true }, requestedSchema: { type: "object", properties: {} } },
    },
    {
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { threadId, turnId: "turn-1", itemId: "command-1", startedAtMs: 1, environmentId: null, command: "smoke command", cwd: process.cwd(), commandActions: null },
    },
    {
      id: "auto-snooze",
      method: "item/tool/requestUserInput",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "auto-snooze-item",
        autoResolutionMs: 240_000,
        questions: [{ id: "action", header: "Action", question: "Pause automatic handling?", isOther: false, isSecret: false, options: [{ label: "Keep waiting", description: "Pause the timer" }] }],
      },
    },
    {
      id: "auto-submit",
      method: "item/tool/requestUserInput",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "auto-submit-item",
        autoResolutionMs: 60_000,
        questions: [{ id: "choice", header: "Choice", question: "Allow automatic handling?", isOther: false, isSecret: false, options: [{ label: "Wait", description: "Leave unanswered" }] }],
      },
    },
  ];
}

function startNext(port: number, bridgeUrl: string): ChildProcess {
  const child = spawn(resolve(process.cwd(), "node_modules/.bin/next"), ["dev", "-H", "0.0.0.0", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WEB_DEMO: "1",
      NEXT_PUBLIC_CODEX_BRIDGE_URL: bridgeUrl,
      CODEX_WEB_LOGIN_EMAIL: webAuth.email,
      CODEX_WEB_LOGIN_PASSWORD: webAuth.password,
      CODEX_WEB_SESSION_SECRET: webAuth.sessionSecret,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", () => undefined);
  return child;
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("未能分配 Next 端口");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForHttp(url: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Next 提前退出：${process.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 等待 dev server。
    }
    await delay(200);
  }
  throw new Error(`等待 Next 启动超时：${url}`);
}

async function stopProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => process.once("exit", () => resolveExit())),
    delay(5_000).then(() => undefined),
  ]);
}

async function createTarget(baseUrl: string): Promise<{ id: string; webSocketDebuggerUrl: string }> {
  const response = await fetch(`${baseUrl}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  if (!response.ok) throw new Error(`创建 CDP target 失败：${response.status}`);
  return response.json() as Promise<{ id: string; webSocketDebuggerUrl: string }>;
}

async function waitForPrompt(cdp: CdpClient, method: string): Promise<void> {
  await waitFor(cdp, `document.querySelector('[data-testid="app-server-request-prompt"]')?.dataset.requestMethod === ${JSON.stringify(method)}`, 15_000);
}

async function setInput(cdp: CdpClient, selector: string, value: string): Promise<void> {
  await evaluate(cdp, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) throw new Error('未找到输入框：${selector}');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  })()`);
}

async function click(cdp: CdpClient, selector: string): Promise<void> {
  await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) throw new Error('未找到元素：${selector}');
    element.click();
  })()`);
}

async function clickButtonByText(cdp: CdpClient, text: string): Promise<void> {
  await evaluate(cdp, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(${JSON.stringify(text)}));
    if (!(button instanceof HTMLButtonElement)) throw new Error('未找到按钮：${text}');
    if (button.disabled) throw new Error('按钮不可用：${text}');
    button.click();
  })()`);
}

async function advanceBrowserClock(cdp: CdpClient, milliseconds: number): Promise<void> {
  await evaluate(cdp, `globalThis.__codexSmokeNowOffsetMs += ${milliseconds}`);
}

async function assert(cdp: CdpClient, expression: string, message: string): Promise<void> {
  if (!await evaluate<boolean>(cdp, `Boolean(${expression})`)) throw new Error(message);
}

async function waitFor(cdp: CdpClient, expression: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate<boolean>(cdp, `Boolean(${expression})`)) return;
    } catch {
      // 导航切换期间 document/execution context 可能短暂不可用。
    }
    await delay(100);
  }
  const body = await evaluate<string>(cdp, "document.body.innerText").catch(() => "");
  throw new Error(`等待页面条件超时：${expression}\n${body.slice(-2000)}`);
}

async function evaluate<T>(cdp: CdpClient, expression: string): Promise<T> {
  const response = await cdp.call<{
    result: { value?: T };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value as T;
}

function expectEqual(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} 不匹配：actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  private constructor(private readonly socket: globalThis.WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new globalThis.WebSocket(url);
    await new Promise<void>((resolveOpen, reject) => {
      socket.addEventListener("open", () => resolveOpen(), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), { once: true });
    });
    return new CdpClient(socket);
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolveCall, reject) => {
      this.pending.set(id, { resolve: (value) => resolveCall(value as T), reject });
      this.socket.send(JSON.stringify(params === undefined ? { id, method } : { id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

await main();
