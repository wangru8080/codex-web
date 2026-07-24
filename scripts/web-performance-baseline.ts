import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";

import WebSocket from "ws";

import {
  buildWebPerformanceScenarioMatrix,
  createHistoryFixtureJsonl,
  summarizeWebPerformanceResults,
  webPerformanceRunDirectoryName,
  type WebPerformanceMode,
  type WebPerformanceProfile,
  type WebPerformanceScenario,
  type WebPerformanceScenarioResult,
} from "../server/web-performance-baseline";
import { resolveTestCodexHome } from "../server/test-codex-home";
import type { WebPerformanceSnapshot } from "../src/lib/web-performance";

const nodeHome = process.env.NODE_HOME ?? "/volume2/SSD/node-v24.14.0";
const outputRoot = process.env.CODEX_WEB_PERFORMANCE_OUTPUT
  ?? "/volume2/SSD/codex/Temp/codex-web-performance-baseline";
const cdpEndpoint = process.env.CODEX_WEB_PERFORMANCE_CDP
  ?? "http://192.168.3.12:45737";
const publicHost = process.env.CODEX_WEB_PERFORMANCE_PUBLIC_HOST ?? "192.168.3.12";
const mode = readMode(process.argv[2]);
const profile = readProfile(process.argv[3]);
const port = Number.parseInt(process.env.CODEX_WEB_PERFORMANCE_PORT ?? (mode === "dev" ? "3001" : "3102"), 10);
if (mode === "dev" && port !== 3000 && port !== 3001) {
  throw new Error("开发基准端口必须是 bridge Origin 白名单中的 3000 或 3001");
}
const loginEmail = "performance-baseline@example.invalid";
const loginPassword = "codex-web-performance-baseline";
const sessionSecret = "codex-web-performance-baseline-session-secret-2026";

async function main(): Promise<void> {
  const runDirectory = path.join(
    outputRoot,
    webPerformanceRunDirectoryName(new Date(), mode, profile),
  );
  await mkdir(outputRoot, { recursive: true });
  await mkdir(runDirectory);

  const codexHome = await prepareCodexHome(profile, runDirectory);
  const fixtureIds = await writeHistoryFixtures(codexHome);
  const fullScenarioMatrix = buildWebPerformanceScenarioMatrix(fixtureIds);
  const scenarios = profile === "default"
    ? fullScenarioMatrix
    : fullScenarioMatrix.filter((scenario) => scenario.name === "empty-chat-cold");
  const server = startServer(mode, port, codexHome, runDirectory);
  let client: CdpClient | null = null;

  try {
    await waitForHttp(`http://127.0.0.1:${port}/login`, 120_000);
    client = await createCdpClient(cdpEndpoint);
    await client.request("Page.enable");
    await client.request("Runtime.enable");
    await login(client, `http://${publicHost}:${port}`);

    const rawResults: Array<WebPerformanceScenarioResult & { raw?: ScenarioSnapshot }> = [];
    for (const scenario of scenarios) {
      const result = await runScenario(client, `http://${publicHost}:${port}`, scenario);
      rawResults.push(result);
      await writeJsonExclusive(path.join(runDirectory, `${scenario.name}.json`), result);
      console.log(`${scenario.name}: ${result.ok ? "ok" : `failed (${result.error})`}`);
    }
    if (profile === "default") {
      const streamingResult = await runStreamingScenario(
        client,
        `http://${publicHost}:${port}`,
        { name: "streaming-turn" },
      );
      rawResults.push(streamingResult);
      await writeJsonExclusive(path.join(runDirectory, "streaming-turn.json"), streamingResult);
      console.log(`streaming-turn: ${streamingResult.ok ? "ok" : `failed (${streamingResult.error})`}`);

      const skillPath = await writePerformanceSkill(runDirectory);
      const skillStreamingResult = await runStreamingScenario(
        client,
        `http://${publicHost}:${port}`,
        { name: "skill-streaming-turn", skillPath },
      );
      rawResults.push(skillStreamingResult);
      await writeJsonExclusive(path.join(runDirectory, "skill-streaming-turn.json"), skillStreamingResult);
      console.log(`skill-streaming-turn: ${skillStreamingResult.ok ? "ok" : `failed (${skillStreamingResult.error})`}`);
    }

    const results = rawResults.map(({ raw: _raw, ...result }) => result);
    const report = {
      generatedAt: new Date().toISOString(),
      mode,
      profile,
      codexHome,
      cdpEndpoint,
      baseUrl: `http://${publicHost}:${port}`,
      fixtureIds,
      results,
      summary: summarizeWebPerformanceResults(results),
    };
    await writeJsonExclusive(path.join(runDirectory, "summary.json"), report);
    console.log(JSON.stringify(report.summary, null, 2));
    console.log(`性能基准结果：${runDirectory}`);
    if (report.summary.failed > 0) process.exitCode = 1;
  } finally {
    client?.close();
    await stopServer(server);
  }
}

function readMode(value: string | undefined): WebPerformanceMode {
  if (value === "dev" || value === "production") return value;
  throw new Error("用法：tsx scripts/web-performance-baseline.ts <dev|production> [default|no-mcp|mcp-heavy]");
}

function readProfile(value: string | undefined): WebPerformanceProfile {
  if (!value || value === "default") return "default";
  if (value === "no-mcp" || value === "mcp-heavy") return value;
  throw new Error(`未知性能配置：${value}`);
}

async function prepareCodexHome(
  selectedProfile: WebPerformanceProfile,
  selectedRunDirectory: string,
): Promise<string> {
  if (selectedProfile === "default") return resolveTestCodexHome();

  const home = path.join(selectedRunDirectory, "codex-home");
  await mkdir(home);
  if (selectedProfile === "no-mcp") {
    await writeFile(path.join(home, "config.toml"), "# Web 性能基线：无 MCP\n", { flag: "wx" });
    return home;
  }

  const mockServer = path.join(selectedRunDirectory, "mock-mcp-server.mjs");
  await writeFile(mockServer, `import readline from "node:readline";
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  const result = request.method === "initialize"
    ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "baseline", version: "1" } }
    : request.method === "tools/list" ? { tools: [] } : {};
  if (request.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
});
`, { flag: "wx" });
  const blocks = Array.from({ length: 8 }, (_, index) => `[mcp_servers.baseline_${String(index + 1).padStart(2, "0")}]
command = "${nodeHome}/bin/node"
args = ["${mockServer}"]
`).join("\n");
  await writeFile(path.join(home, "config.toml"), blocks, { flag: "wx" });
  return home;
}

async function writeHistoryFixtures(selectedCodexHome: string): Promise<{
  ordinaryThreadId: string;
  longThreadId: string;
  plainMarkdownThreadId: string;
  mathMarkdownThreadId: string;
  mermaidMarkdownThreadId: string;
  codeMarkdownThreadId: string;
}> {
  const sessionsDirectory = path.join(selectedCodexHome, "sessions", "2026", "07", "23");
  await mkdir(sessionsDirectory, { recursive: true });
  const ordinaryThreadId = randomUUID();
  const longThreadId = randomUUID();
  const plainMarkdownThreadId = randomUUID();
  const mathMarkdownThreadId = randomUUID();
  const mermaidMarkdownThreadId = randomUUID();
  const codeMarkdownThreadId = randomUUID();
  const fixtures = [
    { threadId: ordinaryThreadId, turnCount: 5, markerPrefix: "perf-ordinary", suffix: "12-00-00" },
    { threadId: longThreadId, turnCount: 120, markerPrefix: "perf-long", suffix: "13-00-00" },
    {
      threadId: plainMarkdownThreadId,
      turnCount: 1,
      markerPrefix: "perf-optional-plain",
      suffix: "14-00-00",
      assistantText: () => "perf-optional-plain-answer：普通 **Markdown**，不包含可选渲染能力。",
    },
    {
      threadId: mathMarkdownThreadId,
      turnCount: 1,
      markerPrefix: "perf-optional-math",
      suffix: "15-00-00",
      assistantText: () => "perf-optional-math-answer：$$E = mc^2$$",
    },
    {
      threadId: mermaidMarkdownThreadId,
      turnCount: 1,
      markerPrefix: "perf-optional-mermaid",
      suffix: "16-00-00",
      assistantText: () => "perf-optional-mermaid-answer\n\n```mermaid\ngraph TD\n  A[Start] --> B[Done]\n```",
    },
    {
      threadId: codeMarkdownThreadId,
      turnCount: 1,
      markerPrefix: "perf-optional-code",
      suffix: "17-00-00",
      assistantText: () => "perf-optional-code-answer\n\n```ts\nconst optionalCode = true;\n```",
    },
  ];
  for (const fixture of fixtures) {
    const rolloutPath = path.join(
      sessionsDirectory,
      `rollout-2026-07-23T${fixture.suffix}-${fixture.threadId}.jsonl`,
    );
    const handle = await open(rolloutPath, "wx");
    try {
      await handle.writeFile(createHistoryFixtureJsonl({
        threadId: fixture.threadId,
        turnCount: fixture.turnCount,
        markerPrefix: fixture.markerPrefix,
        cwd: process.cwd(),
        assistantText: fixture.assistantText,
      }), "utf8");
    } finally {
      await handle.close();
    }
  }
  return {
    ordinaryThreadId,
    longThreadId,
    plainMarkdownThreadId,
    mathMarkdownThreadId,
    mermaidMarkdownThreadId,
    codeMarkdownThreadId,
  };
}

function startServer(
  selectedMode: WebPerformanceMode,
  selectedPort: number,
  selectedCodexHome: string,
  runDirectory: string,
): ChildProcess {
  const command = selectedMode === "dev" ? "dev" : "start";
  const child = spawn("npm", ["run", command], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_HOME: nodeHome,
      PATH: `${nodeHome}/bin:${process.env.PATH ?? ""}`,
      CODEX_HOME: selectedCodexHome,
      CODEX_WEB_LOGIN_EMAIL: loginEmail,
      CODEX_WEB_LOGIN_PASSWORD: loginPassword,
      CODEX_WEB_SESSION_SECRET: sessionSecret,
      CODEX_WEB_PUBLIC_HOST: publicHost,
      CODEX_WEB_NEXT_HOST: "0.0.0.0",
      PORT: String(selectedPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = async (chunk: Buffer, stream: "stdout" | "stderr") => {
    const text = chunk.toString("utf8");
    process[stream].write(text);
    await writeFile(path.join(runDirectory, `${stream}.log`), text, { flag: "a" });
  };
  child.stdout?.on("data", (chunk: Buffer) => void log(chunk, "stdout"));
  child.stderr?.on("data", (chunk: Buffer) => void log(chunk, "stderr"));
  return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
  ]);
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
    await delay(250);
  }
  throw new Error(`等待 Web 服务超时：${url}`);
}

async function createCdpClient(endpoint: string): Promise<CdpClient> {
  const response = await fetch(`${endpoint}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  if (!response.ok) throw new Error(`创建 CDP target 失败：HTTP ${response.status}`);
  const target = await response.json() as { webSocketDebuggerUrl?: string };
  if (!target.webSocketDebuggerUrl) throw new Error("CDP target 缺少 WebSocket URL");
  return CdpClient.connect(target.webSocketDebuggerUrl);
}

async function login(client: CdpClient, baseUrl: string): Promise<void> {
  await client.navigate(`${baseUrl}/login`);
  const status = await client.evaluate<number>(`(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(loginEmail)}, password: ${JSON.stringify(loginPassword)} }),
    });
    return response.status;
  })()`);
  if (status !== 200) throw new Error(`性能基准登录失败：HTTP ${status}`);
}

type ScenarioSnapshot = {
  url: string;
  navigation: Record<string, unknown> | null;
  paints: Array<Record<string, unknown>>;
  performance: WebPerformanceSnapshot;
  renderCounterexample: {
    idleCommitDelta: number;
    inputCommitDelta: number;
  };
  virtualization: VirtualizationSnapshot | null;
  optionalMarkdown: OptionalMarkdownSnapshot | null;
};

type OptionalMarkdownSnapshot = {
  codeLoaded: boolean;
  mathLoaded: boolean;
  mermaidLoaded: boolean;
  shikiLoaded: boolean;
  scriptResourceCount: number;
  scriptTransferSize: number;
  scriptEncodedBodySize: number;
  scripts: string[];
};

type VirtualizationSnapshot = {
  totalMessageCount: number;
  initialMountedMessageCount: number;
  initialAtBottom: boolean;
  topMountedMessageCount: number;
  returnedToBottom: boolean;
};

async function runScenario(
  client: CdpClient,
  baseUrl: string,
  scenario: WebPerformanceScenario,
): Promise<WebPerformanceScenarioResult & { raw?: ScenarioSnapshot }> {
  try {
    if (scenario.resetStorage) {
      await client.request("Network.clearBrowserCache").catch(() => undefined);
    }
    const separator = scenario.path.includes("?") ? "&" : "?";
    await client.navigate(`${baseUrl}${scenario.path}${separator}codexPerformance=1`);
    await client.waitFor(`Boolean(window.__CODEX_WEB_PERFORMANCE__)`, 120_000);
    await client.waitFor(`window.__CODEX_WEB_PERFORMANCE__?.snapshot().entries.some((entry) => entry.name === 'codex.first-interactive')`, 120_000);
    await waitForScenarioContent(client, scenario);
    await delay(500);
    const virtualization = await captureVirtualizationProbe(client, scenario);
    const optionalMarkdown = await captureOptionalMarkdownProbe(client, scenario);

    const commitsBeforeIdle = await profilerCommitCount(client);
    await delay(500);
    const commitsAfterIdle = await profilerCommitCount(client);
    const inputLatencyMs = await client.evaluate<number | null>(`(async () => {
      const input = document.querySelector('textarea');
      if (!(input instanceof HTMLTextAreaElement)) return null;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      const startedAt = performance.now();
      setter?.call(input, 'performance-input-probe');
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'performance-input-probe' }));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      const duration = performance.now() - startedAt;
      setter?.call(input, '');
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      return duration;
    })()`);
    await delay(100);
    const commitsAfterInput = await profilerCommitCount(client);
    const raw = await client.evaluate<ScenarioSnapshot>(`({
      url: location.href,
      navigation: performance.getEntriesByType('navigation')[0]?.toJSON?.() ?? null,
      paints: performance.getEntriesByType('paint').map((entry) => entry.toJSON()),
      performance: window.__CODEX_WEB_PERFORMANCE__.snapshot(),
      renderCounterexample: ${JSON.stringify({
        idleCommitDelta: 0,
        inputCommitDelta: 0,
      })},
      virtualization: ${JSON.stringify(virtualization)},
      optionalMarkdown: ${JSON.stringify(optionalMarkdown)},
    })`);
    raw.renderCounterexample = {
      idleCommitDelta: commitsAfterIdle - commitsBeforeIdle,
      inputCommitDelta: commitsAfterInput - commitsAfterIdle,
    };
    const interactiveMark = raw.performance.entries.find((entry) => entry.name === "codex.first-interactive");
    const routeMeasure = raw.performance.entries.find((entry) => entry.name === "codex.route-duration");
    const navigationDuration = typeof raw.navigation?.duration === "number"
      ? raw.navigation.duration
      : null;
    return {
      name: scenario.name,
      ok: true,
      interactiveMs: interactiveMark?.startTime ?? null,
      routeDurationMs: routeMeasure?.duration ?? navigationDuration,
      inputLatencyMs,
      longTaskCount: raw.performance.summary.longTaskCount,
      maxLongTaskDuration: raw.performance.summary.maxLongTaskDuration,
      raw,
    };
  } catch (error) {
    const raw = await captureScenarioSnapshot(client).catch(() => undefined);
    return {
      name: scenario.name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      interactiveMs: null,
      routeDurationMs: null,
      inputLatencyMs: null,
      longTaskCount: raw?.performance.summary.longTaskCount ?? 0,
      maxLongTaskDuration: raw?.performance.summary.maxLongTaskDuration ?? null,
      raw,
    };
  }
}

async function runStreamingScenario(
  client: CdpClient,
  baseUrl: string,
  options: { name: "streaming-turn" | "skill-streaming-turn"; skillPath?: string },
): Promise<WebPerformanceScenarioResult & { raw?: ScenarioSnapshot }> {
  const scenario: WebPerformanceScenario = {
    name: options.name,
    path: "/chat",
    resetStorage: false,
  };
  try {
    const streamMarker = `BASELINE_STREAM_${Date.now()}`;
    const query = new URLSearchParams({
      new: `performance-${Date.now()}`,
      codexPerformance: "1",
    });
    if (options.skillPath) {
      query.set("skill", "performance-selector-check");
      query.set("skillPath", options.skillPath);
      query.set("skillLabel", "Performance selector check");
      query.set("skillDescription", "验证 Skill 消息仍通过 app-server turn input");
    }
    await client.navigate(`${baseUrl}${scenario.path}?${query.toString()}`);
    await client.waitFor(`Boolean(window.__CODEX_WEB_PERFORMANCE__ && document.querySelector('textarea'))`, 120_000);
    await client.evaluate(`window.dispatchEvent(new CustomEvent('project-directory-changed', {
      detail: { path: ${JSON.stringify(process.cwd())} },
    }))`);
    await client.evaluate(`(() => {
      window.__CODEX_WEB_PERFORMANCE__.reset(${JSON.stringify(options.name)});
      const input = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, ${JSON.stringify(`只回复 ${streamMarker}`)});
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(`只回复 ${streamMarker}`)} }));
    })()`);
    await client.waitFor(`!document.querySelector('[data-message-input-submit]')?.hasAttribute('disabled')`, 10_000);
    await client.evaluate(`document.querySelector('[data-message-input-submit]')?.click()`);
    await client.waitFor(
      `/(停止|Stop)/i.test(document.querySelector('[data-message-input-submit]')?.getAttribute('aria-label') ?? '')`,
      120_000,
    );
    await client.waitFor(
      `!/(停止|Stop)/i.test(document.querySelector('[data-message-input-submit]')?.getAttribute('aria-label') ?? '')
        && ((document.querySelector('main')?.innerText.match(new RegExp(${JSON.stringify(streamMarker)}, 'g'))?.length ?? 0) >= 2)`,
      180_000,
    );
    await delay(500);
    const raw = await client.evaluate<ScenarioSnapshot>(`({
      url: location.href,
      navigation: performance.getEntriesByType('navigation')[0]?.toJSON?.() ?? null,
      paints: performance.getEntriesByType('paint').map((entry) => entry.toJSON()),
      performance: window.__CODEX_WEB_PERFORMANCE__.snapshot(),
      renderCounterexample: { idleCommitDelta: 0, inputCommitDelta: 0 },
      virtualization: null,
      optionalMarkdown: null,
    })`);
    return {
      name: scenario.name,
      ok: true,
      interactiveMs: null,
      routeDurationMs: null,
      inputLatencyMs: null,
      longTaskCount: raw.performance.summary.longTaskCount,
      maxLongTaskDuration: raw.performance.summary.maxLongTaskDuration,
      raw,
    };
  } catch (error) {
    const raw = await captureScenarioSnapshot(client).catch(() => undefined);
    return {
      name: scenario.name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      interactiveMs: null,
      routeDurationMs: null,
      inputLatencyMs: null,
      longTaskCount: raw?.performance.summary.longTaskCount ?? 0,
      maxLongTaskDuration: raw?.performance.summary.maxLongTaskDuration ?? null,
      raw,
    };
  }
}

async function writePerformanceSkill(runDirectory: string): Promise<string> {
  const skillDirectory = path.join(runDirectory, "performance-selector-check");
  await mkdir(skillDirectory);
  const skillPath = path.join(skillDirectory, "SKILL.md");
  await writeFile(skillPath, `---
name: performance-selector-check
description: 验证 selector 重构后 Skill 输入仍可发送
---

收到请求后严格按用户要求回复标记，不执行其他操作。
`, { flag: "wx" });
  return skillPath;
}

async function captureScenarioSnapshot(client: CdpClient): Promise<ScenarioSnapshot> {
  return client.evaluate<ScenarioSnapshot>(`({
    url: location.href,
    navigation: performance.getEntriesByType('navigation')[0]?.toJSON?.() ?? null,
    paints: performance.getEntriesByType('paint').map((entry) => entry.toJSON()),
    performance: window.__CODEX_WEB_PERFORMANCE__.snapshot(),
    renderCounterexample: { idleCommitDelta: 0, inputCommitDelta: 0 },
    virtualization: null,
    optionalMarkdown: null,
  })`);
}

async function captureOptionalMarkdownProbe(
  client: CdpClient,
  scenario: WebPerformanceScenario,
): Promise<OptionalMarkdownSnapshot | null> {
  if (!scenario.name.startsWith("optional-markdown-")) return null;

  const snapshot = await client.evaluate<OptionalMarkdownSnapshot>(`(() => {
    const hasMark = (name) => performance.getEntriesByName(name).length > 0;
    const scripts = performance.getEntriesByType('resource')
      .filter((entry) => entry.initiatorType === 'script');
    return {
      codeLoaded: hasMark('codex.optional-plugin.code.loaded'),
      mathLoaded: hasMark('codex.optional-plugin.math.loaded'),
      mermaidLoaded: hasMark('codex.optional-plugin.mermaid.loaded'),
      shikiLoaded: hasMark('codex.optional-plugin.shiki.loaded'),
      scriptResourceCount: scripts.length,
      scriptTransferSize: scripts.reduce((total, entry) => total + entry.transferSize, 0),
      scriptEncodedBodySize: scripts.reduce((total, entry) => total + entry.encodedBodySize, 0),
      scripts: scripts.map((entry) => entry.name),
    };
  })()`);

  const expected = scenario.name.slice("optional-markdown-".length);
  if (expected === "plain" && (snapshot.codeLoaded || snapshot.mathLoaded || snapshot.mermaidLoaded || snapshot.shikiLoaded)) {
    throw new Error("普通 Markdown 错误加载了可选渲染插件");
  }
  if (expected === "math" && (!snapshot.mathLoaded || snapshot.codeLoaded || snapshot.mermaidLoaded)) {
    throw new Error("数学场景未按需隔离 Math 插件");
  }
  if (expected === "mermaid" && (!snapshot.mermaidLoaded || snapshot.codeLoaded || snapshot.mathLoaded)) {
    throw new Error("Mermaid 场景未按需隔离 Mermaid 插件");
  }
  if (expected === "code" && (!snapshot.codeLoaded || !snapshot.shikiLoaded || snapshot.mathLoaded || snapshot.mermaidLoaded)) {
    throw new Error("代码场景未按需加载共享代码插件与 Shiki");
  }
  return snapshot;
}

async function captureVirtualizationProbe(
  client: CdpClient,
  scenario: WebPerformanceScenario,
): Promise<VirtualizationSnapshot | null> {
  if (scenario.name !== "ordinary-history" && scenario.name !== "long-history") return null;

  const initial = await client.evaluate<{
    totalMessageCount: number;
    mountedMessageCount: number;
    atBottom: boolean;
  }>(`(() => {
    const root = document.querySelector('[data-virtualized-message-list]');
    const scroller = root?.querySelector('[data-message-list-scroller]');
    if (!(root instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
      throw new Error('消息虚拟列表或滚动容器不存在');
    }
    return {
      totalMessageCount: Number(root.dataset.messageCount ?? 0),
      mountedMessageCount: root.querySelectorAll('[data-message-row], [data-streaming-message-row]').length,
      atBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 64,
    };
  })()`);

  await client.evaluate(`(() => {
    const scroller = document.querySelector('[data-message-list-scroller]');
    if (!(scroller instanceof HTMLElement)) throw new Error('消息滚动容器不存在');
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));
  })()`);
  await delay(300);
  const topMountedMessageCount = await client.evaluate<number>(
    `document.querySelectorAll('[data-message-row], [data-streaming-message-row]').length`,
  );

  await client.evaluate(`(() => {
    const scroller = document.querySelector('[data-message-list-scroller]');
    if (!(scroller instanceof HTMLElement)) throw new Error('消息滚动容器不存在');
    scroller.scrollTop = scroller.scrollHeight;
    scroller.dispatchEvent(new Event('scroll'));
  })()`);
  await client.waitFor(`(() => {
    const scroller = document.querySelector('[data-message-list-scroller]');
    return scroller instanceof HTMLElement
      && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 64;
  })()`, 5_000);
  const returnedToBottom = await client.evaluate<boolean>(`(() => {
    const scroller = document.querySelector('[data-message-list-scroller]');
    if (!(scroller instanceof HTMLElement)) return false;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 64;
  })()`);

  const snapshot = {
    totalMessageCount: initial.totalMessageCount,
    initialMountedMessageCount: initial.mountedMessageCount,
    initialAtBottom: initial.atBottom,
    topMountedMessageCount,
    returnedToBottom,
  };
  if (scenario.name === "long-history") {
    if (snapshot.totalMessageCount <= 0) throw new Error("长历史虚拟列表未报告消息总数");
    if (snapshot.initialMountedMessageCount >= snapshot.totalMessageCount) {
      throw new Error("长历史场景仍挂载了全部消息 DOM");
    }
    if (!snapshot.initialAtBottom || !snapshot.returnedToBottom) {
      throw new Error("长历史虚拟列表未保持初始底部位置或无法返回底部");
    }
  }
  return snapshot;
}

async function waitForScenarioContent(
  client: CdpClient,
  scenario: WebPerformanceScenario,
): Promise<void> {
  if (scenario.name === "ordinary-history") {
    await client.waitFor(
      `document.body.innerText.includes('perf-ordinary-answer-005') && Boolean(document.querySelector('textarea'))`,
      20_000,
    );
    return;
  }
  if (scenario.name === "long-history") {
    await client.waitFor(
      `document.body.innerText.includes('perf-long-answer-120') && Boolean(document.querySelector('textarea'))`,
      20_000,
    );
    await client.waitFor(`(() => {
      const scroller = document.querySelector('[data-message-list-scroller]');
      return scroller instanceof HTMLElement
        && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 64;
    })()`, 20_000);
    return;
  }
  if (scenario.name.startsWith("optional-markdown-")) {
    const marker = scenario.name.replace("optional-markdown-", "perf-optional-");
    await client.waitFor(`document.body.innerText.includes('${marker}-answer')`, 20_000);
    if (scenario.name === "optional-markdown-math") {
      await client.waitFor(`Boolean(document.querySelector('.katex'))`, 20_000);
    } else if (scenario.name === "optional-markdown-mermaid") {
      await client.waitFor(`Boolean(document.querySelector('[data-streamdown="mermaid"]'))`, 20_000);
    } else if (scenario.name === "optional-markdown-code") {
      await client.waitFor(`performance.getEntriesByName('codex.optional-plugin.shiki.loaded').length > 0`, 20_000);
    }
    return;
  }
  if (scenario.name.startsWith("empty-chat")) {
    await client.waitFor(`Boolean(document.querySelector('textarea'))`, 60_000);
  }
}

async function profilerCommitCount(client: CdpClient): Promise<number> {
  return client.evaluate<number>(
    `window.__CODEX_WEB_PERFORMANCE__?.snapshot().profilerCommits.length ?? 0`,
  );
}

async function writeJsonExclusive(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => this.handleMessage(data.toString("utf8")));
    socket.once("close", () => this.rejectAll(new Error("CDP WebSocket 已关闭")));
    socket.once("error", (error) => this.rejectAll(error));
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new CdpClient(socket);
  }

  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
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
        // 导航期间执行上下文可能被替换。
      }
      await delay(100);
    }
    throw new Error(`等待浏览器条件超时：${expression}`);
  }

  close(): void {
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

await main();
