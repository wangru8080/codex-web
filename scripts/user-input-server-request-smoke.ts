import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

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
  debug("等待 Next 页面");
  await waitForHttp(`http://127.0.0.1:${appPort}/chat/${threadId}`, next);
  debug("Next 页面可访问，创建 CDP target");
  target = await createTarget(cdpBaseUrl);
  cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Network.enable");
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
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
  await waitFor(cdp, `document.body.innerText.includes("用户输入 Smoke") && (document.querySelector("textarea") !== null || document.body.innerText.includes("This page could not be found"))`, 30_000);
  if (!await evaluate<boolean>(cdp, `document.querySelector("textarea") !== null`)) {
    const isRoute404 = await evaluate<boolean>(cdp, `document.body.innerText.includes("This page could not be found")`);
    if (!isRoute404) throw new Error("聊天页未渲染输入框");
    debug("动态聊天路由首次返回 404，重新导航一次");
    await cdp.call("Page.navigate", { url: `${appUrl}/chat/${threadId}` });
  }
  await waitFor(cdp, `document.querySelector("textarea") !== null`, 30_000);
  debug("聊天页面已渲染，开始 Git 面板断言");

  if (!await evaluate<boolean>(cdp, `document.querySelector("#tab-git") !== null`)) {
    await click(cdp, '[aria-label="工作区侧栏"]');
    await waitFor(cdp, `document.querySelector("#tab-git") !== null`, 15_000);
  }
  await click(cdp, "#tab-git");
  await waitFor(cdp, `document.querySelector('[data-testid="git-panel"]') !== null`, 15_000);
  debug("Git 面板已渲染");
  await assert(cdp, `document.querySelector('[data-testid="git-panel"]')?.textContent?.includes("+3") === true`, "Git 面板新增行总计错误");
  await assert(cdp, `document.querySelector('[data-testid="git-panel"]')?.textContent?.includes("-1") === true`, "Git 面板删除行总计错误");
  await assert(cdp, `document.querySelector('[data-testid="git-panel"] [title="src/app.ts"]') !== null`, "Git 面板缺少已修改文件");
  await assert(cdp, `document.querySelector('[data-testid="git-panel"] [title="src/new.ts"]') !== null`, "Git 面板缺少未跟踪文件");
  await assert(cdp, `document.querySelector('[data-testid="git-history"]') === null`, "普通更改路径不应提前渲染 Git 历史");
  await captureScreenshot(cdp, "01-git-status.png");

  await click(cdp, '[data-testid="git-view-history"]');
  await waitFor(cdp, `document.querySelector('[data-testid="git-history-commit-1111111"]') !== null`, 15_000);
  await click(cdp, '[data-testid="git-history-commit-1111111"]');
  await waitFor(cdp, `document.querySelector('[data-testid="git-history-file"]')?.textContent?.includes("src/history.ts") === true`, 15_000);
  await captureScreenshot(cdp, "04-git-history.png");
  await click(cdp, '[data-testid="git-history-file"]');
  await waitFor(cdp, `document.body.innerText.includes("+const historicalValue = 2;")`, 15_000);
  await captureScreenshot(cdp, "05-history-diff.png");

  await click(cdp, "#tab-git");
  await waitFor(cdp, `document.querySelector('[data-testid="git-history"]') !== null`, 15_000);
  await assert(cdp, `document.querySelector('[data-testid="git-view-history"]')?.getAttribute("data-state") === "active"`, "从历史 diff 返回后应保留历史视图");
  await waitFor(cdp, `document.querySelector('[data-testid="git-history-commit-1111111"]') !== null`, 15_000);
  await click(cdp, '[data-testid="git-history-commit-1111111"]');
  await waitFor(cdp, `document.querySelector('[aria-label="只读查看 src/history.ts 的历史版本"]') !== null`, 2_000).catch(async () => {
    await click(cdp!, '[data-testid="git-history-commit-1111111"]');
  });
  await waitFor(cdp, `document.querySelector('[aria-label="只读查看 src/history.ts 的历史版本"]') !== null`, 15_000);
  await click(cdp, '[aria-label="只读查看 src/history.ts 的历史版本"]');
  await waitFor(cdp, `document.body.innerText.includes("const historicalValue = 2;") && document.body.innerText.includes("只读")`, 15_000);
  await captureScreenshot(cdp, "06-history-file.png");
  console.log("Git 历史 smoke 通过：普通路径不预取历史，提交可展开文件，diff 与完整版本均只读打开");

  await click(cdp, "#tab-git");
  await waitFor(cdp, `document.querySelector('[data-testid="git-view-changes"]') !== null`, 15_000);
  await click(cdp, '[data-testid="git-view-changes"]');
  await click(cdp, '[data-testid="git-panel"] [title="src/app.ts"]');
  await waitFor(cdp, `document.body.innerText.includes("-const oldValue = 2;")`, 15_000);
  await captureScreenshot(cdp, "02-file-diff.png");
  debug("Git 文件 diff 已打开");
  await click(cdp, "#tab-git");
  await waitFor(cdp, `document.querySelector('[data-testid="git-panel"] input[aria-label="src/app.ts"]') !== null`, 15_000);
  await click(cdp, '[data-testid="git-panel"] input[aria-label="src/app.ts"]');
  await clickButtonByText(cdp, "提交 1 个文件");
  await setTextarea(cdp, '[data-testid="git-commit-dialog"] textarea', "测试：只提交 app.ts");
  await captureScreenshot(cdp, "03-commit-dialog.png");
  await click(cdp, '[data-testid="git-commit-submit"]');
  await waitFor(cdp, `document.querySelector('[data-testid="git-commit-dialog"]') === null`, 15_000);
  debug("Git 提交弹窗已关闭");
  await waitFor(cdp, `document.querySelector('[data-testid="git-panel"] [title="src/app.ts"]') === null`, 15_000);
  await assert(cdp, `document.querySelector('[data-testid="git-panel"] [title="src/new.ts"]') !== null`, "部分提交后 Git 面板应保留未提交文件");
  fake.setGitStatus("all");
  await cdp.call("Runtime.evaluate", { expression: `window.dispatchEvent(new CustomEvent("git-refresh"))` });
  console.log("最小 Git 面板 smoke 通过：真实点击文件 diff、选择单文件并提交、部分提交后保留剩余文件");

  await assert(cdp, `document.querySelector('[data-testid="composer-file-changes"]') === null`, "普通路径不应显示文件变更汇总");
  await assert(cdp, `document.querySelector('[data-testid="composer-turn-plan"]') === null`, "普通路径不应显示任务进度");
  fake.sendTurnPlan("running");
  await waitFor(cdp, `document.querySelector('[data-testid="composer-turn-plan-standalone"]')?.textContent?.includes("1/3 项任务已完成") === true`, 15_000);
  await waitFor(cdp, `document.querySelector('[data-testid="composer-turn-plan-panel"]') !== null`, 15_000);
  await assert(cdp, `document.querySelector('[data-testid="composer-activity-bar"]')?.dataset.variant === "standalone-task"`, "只有任务时应使用独立面板");
  await assert(cdp, `document.querySelectorAll('[data-testid="turn-task-checklist"]').length === 1`, "独立任务面板应默认展开");
  await captureScreenshot(cdp, "10-turn-task-standalone.png");
  await click(cdp, '[data-testid="composer-turn-plan"]');
  await waitFor(cdp, `document.querySelector('[data-testid="composer-turn-plan-panel"]') === null`, 15_000);
  await click(cdp, '[data-testid="composer-turn-plan"]');
  await waitFor(cdp, `document.querySelector('[data-testid="composer-turn-plan-panel"]') !== null`, 15_000);
  fake.sendFileChanges();
  await waitFor(cdp, `document.querySelector('[data-testid="composer-file-changes"]')?.textContent?.includes("2 个文件已更改") === true`, 15_000);
  await assert(cdp, `document.querySelector('[data-testid="composer-file-changes"]')?.textContent?.includes("+3") === true`, "文件变更新增行统计错误");
  await assert(cdp, `document.querySelector('[data-testid="composer-file-changes"]')?.textContent?.includes("-1") === true`, "文件变更删除行统计错误");
  await waitFor(cdp, `document.querySelector('[data-testid="composer-turn-plan"]')?.textContent?.includes("1/3") === true`, 15_000);
  await waitFor(cdp, `document.querySelector('[data-testid="composer-turn-plan-panel"]') === null`, 15_000);
  await assert(cdp, `document.querySelector('[data-testid="composer-activity-bar"]')?.dataset.variant === "compact"`, "文件变更出现后应切换为双胶囊布局");
  await assert(cdp, `document.querySelector('[data-testid="composer-turn-plan"]')?.dataset.variant === "compact"`, "双 UI 场景应使用任务胶囊");
  await assert(cdp, `document.querySelector('[data-testid="composer-activity-bar"]')?.children[0]?.getAttribute("data-testid") === "composer-file-changes"`, "文件变更应位于活动条左侧");
  await assert(cdp, `document.querySelector('[data-testid="composer-activity-bar"]')?.children[1]?.getAttribute("data-testid") === "composer-turn-plan"`, "任务进度应位于活动条右侧");
  await captureScreenshot(cdp, "11-turn-task-with-files.png");
  await click(cdp, '[data-testid="composer-file-changes"] > button');
  await waitFor(cdp, `document.querySelector('[data-testid="composer-file-changes"] [title="src/app.ts"]') !== null`, 15_000);
  await click(cdp, '[data-testid="composer-turn-plan"]');
  await waitFor(cdp, `document.querySelector('[data-testid="composer-turn-plan-panel"]') !== null`, 15_000);
  await assert(cdp, `document.querySelector('[data-testid="composer-file-changes"] [title="src/app.ts"]') === null`, "展开任务时应自动关闭文件列表，避免浮层重叠");
  await assert(cdp, `document.querySelector('[data-testid="composer-turn-plan-panel"] [data-task-status="completed"]')?.textContent?.includes("建立任务状态") === true`, "已完成任务内容错误");
  await assert(cdp, `document.querySelector('[data-testid="composer-turn-plan-panel"] [data-task-status="completed"] > span:last-child')?.classList.contains("line-through") === true`, "已完成任务应显示删除线");
  await assert(cdp, `document.querySelector('[data-testid="composer-turn-plan-panel"] [data-task-status="inProgress"]')?.textContent?.includes("实现悬浮 UI") === true`, "进行中任务内容错误");
  await assert(cdp, `document.querySelector('[data-testid="composer-turn-plan-panel"] [data-task-status="pending"]')?.textContent?.includes("运行浏览器验证") === true`, "待执行任务内容错误");
  await assert(cdp, `document.querySelectorAll('[data-testid="turn-task-checklist"]').length === 1`, "执行任务只应在输入框浮层展示");
  await captureScreenshot(cdp, "12-turn-task-with-files-expanded.png");
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await assert(cdp, `document.documentElement.scrollWidth <= window.innerWidth`, "移动端任务浮层不应产生横向溢出");
  await captureScreenshot(cdp, "13-turn-task-mobile.png");
  await cdp.call("Emulation.setDeviceMetricsOverride", {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  fake.sendTurnPlan("progressed");
  await waitFor(cdp, `document.querySelector('[data-testid="composer-turn-plan"]')?.textContent?.includes("2/3") === true`, 15_000);
  fake.setGitStatus("clean");
  await cdp.call("Runtime.evaluate", { expression: `window.dispatchEvent(new CustomEvent("git-refresh"))` });
  await waitFor(cdp, `document.querySelector('[data-testid="composer-file-changes"]') === null`, 15_000);
  await waitFor(cdp, `document.querySelector('[data-testid="composer-turn-plan-standalone"]')?.textContent?.includes("2/3 项任务已完成") === true`, 15_000);
  await assert(cdp, `document.querySelector('[data-testid="composer-turn-plan-panel"]') !== null`, "文件变更消失后应恢复并展开独立任务面板");
  fake.setGitStatus("unavailable");
  await cdp.call("Runtime.evaluate", { expression: `window.dispatchEvent(new CustomEvent("git-refresh"))` });
  await waitFor(cdp, `document.querySelector('[data-testid="composer-file-changes"]') !== null`, 15_000);
  await waitFor(cdp, `document.querySelector('[data-testid="composer-activity-bar"]')?.dataset.variant === "compact"`, 15_000);
  fake.sendTurnPlan("completed");
  await waitFor(cdp, `document.querySelector('[data-testid="composer-turn-plan"]') === null`, 15_000);
  await assert(cdp, `document.querySelector('[data-testid="composer-file-changes"]') !== null`, "任务完成后文件变更 UI 应继续保留");
  console.log("任务进度 UI smoke 通过：仅任务时独立展开，文件出现时切换双胶囊，文件消失后恢复独立面板，完成后自动退出");
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
  await assert(cdp, `document.querySelector('[data-testid="request-user-input-close"]') !== null`, "结构化提问应显示关闭按钮");
  await assert(cdp, `document.querySelector('[data-testid="request-user-input-skip"]') !== null`, "结构化提问应显示跳过按钮");
  await assert(cdp, `document.querySelector('[data-testid="request-user-input-submit"]') === null`, "选项问题不应显示通用提交按钮");
  await captureScreenshot(cdp, "12-request-user-input.png");
  await clickButtonByText(cdp, "Production");
  await assert(cdp, `document.querySelector('[data-testid="request-user-input-submit"]')?.disabled === true`, "自由输入为空时确认按钮应禁用");
  await setInput(cdp, 'input[type="password"]', "smoke-secret");
  await click(cdp, '[data-testid="request-user-input-submit"]');
  expectEqual(await fake.waitForResponse("input-1"), {
    answers: {
      environment: { answers: ["Production"] },
      token: { answers: ["smoke-secret"] },
    },
  }, "requestUserInput response");

  await waitForPrompt(cdp, "item/tool/requestUserInput");
  await click(cdp, '[data-testid="request-user-input-skip"]');
  expectEqual(await fake.waitForResponse("input-skip"), { answers: {} }, "requestUserInput skip response");

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
  await assert(cdp, `document.querySelector('[data-testid="request-user-input-auto-resolution-countdown"]')?.querySelector('svg') !== null`, "可见倒计时应在标题栏显示时钟图标");
  await click(cdp, '[data-testid="request-user-input-other"]');
  await waitFor(cdp, `document.querySelector('[data-testid="request-user-input-auto-resolution-countdown"]') === null`, 3_000);
  await advanceBrowserClock(cdp, 120_000);
  await delay(1_200);
  if (fake.hasResponse("auto-snooze")) throw new Error("用户交互后不应自动响应 requestUserInput");
  await setInput(cdp, '[data-testid="request-user-input-custom-answer"]', "Continue manually");
  await click(cdp, '[data-testid="request-user-input-submit"]');
  expectEqual(await fake.waitForResponse("auto-snooze"), {
    answers: { action: { answers: ["Continue manually"] } },
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

  console.log("用户输入 server request smoke 通过：官方样式表单、跳过、倒计时、自动处理、FIFO、跨 thread、文件变更统计与右侧 diff 反例均符合预期");
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
  sendTurnPlan: (stage: "running" | "progressed" | "completed") => void;
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
        const command = commandFromParams(message.params);
        const result = responseForMethod(message.method, message.params, gitStatus);
        if (message.method === "command/exec" && command.includes("commit") && (result as { exitCode?: number }).exitCode === 0) {
          gitStatus = command.includes("src/app.ts") ? "partial" : "clean";
        }
        socket.send(JSON.stringify({ id: message.id, result }));
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
    sendTurnPlan: (stage) => {
      if (!client || client.readyState !== client.OPEN) throw new Error("fake app-server 尚未连接");
      if (stage === "running") {
        client.send(JSON.stringify({ method: "turn/started", params: { threadId, turn: { id: "turn-file-smoke", status: "inProgress" } } }));
      }
      client.send(JSON.stringify(turnPlanNotification(stage)));
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
    close: () => new Promise<void>((resolveClose) => {
      for (const socket of server.clients) socket.terminate();
      server.close(() => resolveClose());
    }),
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
    { method: "item/started", params: { threadId, turnId: "turn-file-smoke", item: { type: "fileChange", id: "patch-smoke", changes: [], status: "inProgress" } } },
    { method: "turn/diff/updated", params: { threadId, turnId: "turn-file-smoke", diff: changes.map((change) => change.diff).join("\n") } },
    { method: "item/fileChange/patchUpdated", params: { threadId, turnId: "turn-file-smoke", itemId: "patch-smoke", changes } },
  ];
}

function turnPlanNotification(stage: "running" | "progressed" | "completed"): unknown {
  const completedCount = stage === "running" ? 1 : stage === "progressed" ? 2 : 3;
  return {
    method: "turn/plan/updated",
    params: {
      threadId,
      turnId: "turn-file-smoke",
      explanation: "使用真实 app-server 计划进度验证输入框任务 UI。",
      plan: [
        { step: "建立任务状态", status: "completed" },
        { step: "实现悬浮 UI", status: completedCount >= 2 ? "completed" : "inProgress" },
        { step: "运行浏览器验证", status: completedCount >= 3 ? "completed" : completedCount === 2 ? "inProgress" : "pending" },
      ],
    },
  };
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
      const command = commandFromParams(params);
      if (gitStatus === "unavailable") return { exitCode: 128, stdout: "", stderr: "not a git repository" };
      if (command.includes("--absolute-git-dir") || command.includes("--git-common-dir")) {
        return { exitCode: 0, stdout: `${process.cwd()}/.git\n`, stderr: "" };
      }
      if (command.includes("rev-parse")) return { exitCode: 0, stdout: `${process.cwd()}\n`, stderr: "" };
      if (command.includes("status")) {
        const stdout = gitStatus === "all"
          ? "## main\0 M src/app.ts\0?? src/new.ts\0"
          : gitStatus === "partial"
            ? "## main\0?? src/new.ts\0"
            : "## main\0";
        return { exitCode: 0, stdout, stderr: "" };
      }
      if (command.includes("log")) {
        return {
          exitCode: 0,
          stdout: "\x1e1111111111111111111111111111111111111111\x00Smoke User\x00smoke@example.com\x002026-07-26T09:00:00+08:00\x00feat: 历史提交",
          stderr: "",
        };
      }
      if (command.includes("diff-tree")) {
        return { exitCode: 0, stdout: "M\0src/history.ts\0", stderr: "" };
      }
      if (command.includes("cat-file")) {
        return { exitCode: 0, stdout: "34\n", stderr: "" };
      }
      if (command.includes("show")) {
        const revisionFile = command.find((part) => part.includes(":"));
        return revisionFile
          ? { exitCode: 0, stdout: "export const historicalValue = 2;\n", stderr: "" }
          : { exitCode: 0, stdout: "--- a/src/history.ts\n+++ b/src/history.ts\n@@ -1 +1 @@\n-const historicalValue = 1;\n+const historicalValue = 2;", stderr: "" };
      }
      if (command.includes("--numstat")) {
        if (command.includes("--no-index")) {
          return { exitCode: 1, stdout: "1\t0\t\0/dev/null\0src/new.ts\0", stderr: "" };
        }
        return { exitCode: 0, stdout: gitStatus === "all" ? "2\t1\tsrc/app.ts\0" : "", stderr: "" };
      }
      if (command.includes("diff")) {
        if (command.includes("--no-index")) {
          return { exitCode: 1, stdout: "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1 @@\n+export {};", stderr: "" };
        }
        return { exitCode: 0, stdout: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n const value = 1;\n-const oldValue = 2;\n+const nextValue = 2;\n+export { nextValue };", stderr: "" };
      }
      if (command.includes("add") || command.includes("commit")) return { exitCode: 0, stdout: "ok", stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "unsupported fake command" };
    }
    default:
      return {};
  }
}

function commandFromParams(params: unknown): string[] {
  return params && typeof params === "object" && Array.isArray((params as { command?: unknown }).command)
    ? (params as { command: string[] }).command
    : [];
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
      id: "input-skip",
      method: "item/tool/requestUserInput",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "skip-item",
        autoResolutionMs: null,
        questions: [{ id: "skip", header: "Skip", question: "Skip this question?", isOther: true, isSecret: false, options: [{ label: "Answer", description: "Do not skip" }] }],
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
        questions: [{ id: "action", header: "Action", question: "Pause automatic handling?", isOther: true, isSecret: false, options: [{ label: "Keep waiting", description: "Submit immediately" }] }],
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
  const mode = process.env.CODEX_SMOKE_NEXT_MODE === "start" ? "start" : "dev";
  const nextBin = resolve(process.cwd(), "node_modules/.bin/next");
  const env = {
    ...process.env,
    CODEX_WEB_DEMO: "1",
    NEXT_PUBLIC_CODEX_BRIDGE_URL: bridgeUrl,
    CODEX_WEB_LOGIN_EMAIL: webAuth.email,
    CODEX_WEB_LOGIN_PASSWORD: webAuth.password,
    CODEX_WEB_SESSION_SECRET: webAuth.sessionSecret,
  };
  if (mode === "start") {
    execFileSync(nextBin, ["build"], { cwd: process.cwd(), env, stdio: "inherit" });
  }
  const child = spawn(nextBin, [mode, "-H", "0.0.0.0", "-p", String(port)], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (data) => debug(`[next stdout] ${String(data).trimEnd()}`));
  child.stderr?.on("data", (data) => debug(`[next stderr] ${String(data).trimEnd()}`));
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
  if (process.exitCode === null) process.kill("SIGKILL");
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

async function setTextarea(cdp: CdpClient, selector: string, value: string): Promise<void> {
  await evaluate(cdp, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('未找到文本框：${selector}');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
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

async function captureScreenshot(cdp: CdpClient, filename: string): Promise<void> {
  const directory = process.env.CODEX_SMOKE_SCREENSHOT_DIR?.trim();
  if (!directory) return;
  const filter = process.env.CODEX_SMOKE_SCREENSHOT_FILTER?.split(",").map((item) => item.trim()).filter(Boolean);
  if (filter?.length && !filter.includes(filename)) return;
  const outputPath = join(directory, filename);
  if (existsSync(outputPath)) throw new Error(`拒绝覆盖已有截图：${outputPath}`);
  const response = await cdp.call<{ data: string }>("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  writeFileSync(outputPath, Buffer.from(response.data, "base64"));
  console.log(`截图已保存：${outputPath}`);
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

function debug(message: string): void {
  if (process.env.CODEX_SMOKE_DEBUG === "1") console.log(`[smoke] ${message}`);
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
