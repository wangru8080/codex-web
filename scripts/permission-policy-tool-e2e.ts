import { access, mkdir, readFile, stat } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";

import WebSocket from "ws";

import { createWebSocketBridge } from "../server/websocket-bridge";
import { appServerInitializeCapabilities } from "../src/codex-web/app-server-capabilities";
import { threadPermissionUpdateOptions } from "../src/codex-web/app-server-runtime-options";
import type { ConfigReadResponse } from "../src/codex/protocol/generated/v2/ConfigReadResponse";

const requiredCodexHome = "/volume2/SSD/codex/Temp/codex-dev-home";
const testRoot = "/volume2/SSD/codex/Temp/codex-permission-e2e-20260714-142802";
const workspace = path.join(testRoot, "workspace");
const outside = path.join(testRoot, "outside");
const approvalMethods = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
]);

type JsonRpcMessage = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type Notification = { method: string; params?: unknown };
type ScenarioName = "request" | "auto" | "full" | "config";
type Scenario = {
  name: ScenarioName;
  markerText: string;
  threadParams: Record<string, unknown>;
  approvals: Array<{ method: string; params: unknown }>;
  autoStarted: Notification[];
  autoCompleted: Notification[];
  unexpectedRequests: string[];
};

async function main(): Promise<void> {
  if (process.env.CODEX_HOME !== requiredCodexHome) {
    throw new Error(`真实权限 E2E 必须使用隔离 CODEX_HOME：${requiredCodexHome}`);
  }
  await assertMissing(testRoot);
  await mkdir(workspace, { recursive: true });
  await mkdir(outside, { recursive: true });

  const bridge = createWebSocketBridge({ token: "permission-policy-tool-e2e-token" });
  try {
    await waitForListening(bridge.server);
    const client = new RpcClient(new WebSocket(`${bridge.url()}?token=${bridge.token}`));
    const initialize = await client.request("initialize", {
      clientInfo: {
        name: "codex_web_permission_tool_e2e",
        title: "Codex Web Permission Tool E2E",
        version: "0.0.0",
      },
      capabilities: appServerInitializeCapabilities(),
    }) as { codexHome?: string };
    await client.notify("initialized");
    if (initialize.codexHome !== requiredCodexHome) {
      throw new Error(`app-server 使用了错误 CODEX_HOME：${initialize.codexHome ?? "未返回"}`);
    }

    const models = await client.request("model/list", { includeHidden: false }) as {
      data?: Array<{ id: string; hidden?: boolean; isDefault?: boolean }>;
    };
    const model = models.data?.find((item) => !item.hidden && item.isDefault)?.id
      ?? models.data?.find((item) => !item.hidden)?.id;
    if (!model) throw new Error("model/list 没有返回可用模型");

    const config = await client.request("config/read", {
      cwd: workspace,
      includeLayers: false,
    }) as ConfigReadResponse;
    const configuredProfile = readConfiguredProfile(config);
    const scenarios: Scenario[] = [
      scenario("request", "request-ok", {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        permissions: ":workspace",
      }),
      scenario("auto", "auto-ok", {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        permissions: ":workspace",
      }),
      scenario("full", "full-ok", {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        permissions: ":danger-full-access",
      }),
      scenario(
        "config",
        "config-ok",
        threadPermissionUpdateOptions("config", workspace, configuredProfile, config),
      ),
    ];

    const scenarioByThread = new Map<string, Scenario>();
    client.onServerRequest(async (message) => {
      const params = asRecord(message.params);
      const threadId = typeof params.threadId === "string" ? params.threadId : "";
      const active = scenarioByThread.get(threadId);
      if (!active || !message.method || !approvalMethods.has(message.method)) {
        client.respondError(message.id, -32601, `E2E 不处理 server request：${message.method ?? "unknown"}`);
        return;
      }
      active.approvals.push({ method: message.method, params: message.params });
      if (active.name === "auto" || active.name === "full") {
        active.unexpectedRequests.push(message.method);
        client.respondResult(message.id, declineResponse(message.method));
        return;
      }
      client.respondResult(message.id, allowResponse(message.method, params));
    });
    client.onNotification((notification) => {
      const params = asRecord(notification.params);
      const threadId = typeof params.threadId === "string" ? params.threadId : "";
      const active = scenarioByThread.get(threadId);
      if (!active) return;
      if (notification.method === "item/autoApprovalReview/started") active.autoStarted.push(notification);
      if (notification.method === "item/autoApprovalReview/completed") active.autoCompleted.push(notification);
    });

    for (const active of scenarios) {
      await runScenario(client, model, active, scenarioByThread);
    }

    printSummary(model, configuredProfile, scenarios);
    client.close();
  } finally {
    await bridge.close();
  }
}

function scenario(
  name: ScenarioName,
  markerText: string,
  threadParams: Record<string, unknown>,
): Scenario {
  return {
    name,
    markerText,
    threadParams,
    approvals: [],
    autoStarted: [],
    autoCompleted: [],
    unexpectedRequests: [],
  };
}

async function runScenario(
  client: RpcClient,
  model: string,
  active: Scenario,
  scenarioByThread: Map<string, Scenario>,
): Promise<void> {
  const started = await client.request("thread/start", {
    cwd: workspace,
    model,
    ephemeral: true,
    threadSource: `codex_web_permission_tool_e2e_${active.name}`,
    serviceName: "codex_web",
    ...active.threadParams,
  }) as { thread?: { id?: string } };
  const threadId = started.thread?.id;
  if (!threadId) throw new Error(`${active.name}：thread/start 未返回 thread.id`);
  scenarioByThread.set(threadId, active);

  const marker = path.join(outside, `${active.name}-marker.txt`);
  const network = path.join(outside, `${active.name}-network.html`);
  const command = `printf '${active.markerText}' > '${marker}' && curl --fail --silent --show-error --max-time 20 'https://example.com/' > '${network}'`;
  const completion = client.waitForNotification((notification) => {
    if (notification.method !== "turn/completed") return false;
    return asRecord(notification.params).threadId === threadId;
  }, 180_000);

  await client.request("turn/start", {
    threadId,
    cwd: workspace,
    model,
    input: [{
      type: "text",
      text: `这是权限策略自动化 E2E。必须实际调用 shell 工具，并且只执行下面这一条命令，不要改写命令，不要用其他工具：\n${command}\n命令完成后简短报告退出状态。`,
      text_elements: [],
    }],
  });

  const completed = asRecord((await completion).params);
  const turn = asRecord(completed.turn);
  if (turn.status !== "completed") {
    throw new Error(`${active.name}：turn 状态为 ${String(turn.status)}，错误=${JSON.stringify(turn.error)}`);
  }
  if (active.unexpectedRequests.length > 0) {
    throw new Error(`${active.name}：出现不应由用户处理的 approval：${active.unexpectedRequests.join(", ")}`);
  }

  if (active.name === "auto") {
    if (active.approvals.length > 0) {
      throw new Error(`auto：Auto Review 模式仍向客户端发送了 ${active.approvals.length} 个 approval`);
    }
    if (active.autoStarted.length === 0 || active.autoCompleted.length === 0) {
      throw new Error("auto：缺少 item/autoApprovalReview started/completed 通知");
    }
    const statuses = active.autoCompleted.map((item) => asRecord(asRecord(item.params).review).status);
    const markerExists = await exists(marker);
    if (markerExists) {
      await assertArtifacts(marker, network, active.markerText);
    } else if (!statuses.some((status) => status === "denied" || status === "timedOut" || status === "aborted")) {
      throw new Error(`auto：没有产生文件，也没有明确拒绝结果：${JSON.stringify(statuses)}`);
    }
    return;
  }

  if (active.name === "full") {
    if (active.approvals.length !== 0) throw new Error("full：完全访问模式出现 approval");
  } else if (active.approvals.length === 0) {
    throw new Error(`${active.name}：没有触发真实用户 approval`);
  }
  await assertArtifacts(marker, network, active.markerText);
}

function allowResponse(method: string, params: Record<string, unknown>): unknown {
  if (method === "item/permissions/requestApproval") {
    const requested = asRecord(params.permissions);
    return {
      permissions: {
        ...(requested.network ? { network: requested.network } : {}),
        ...(requested.fileSystem ? { fileSystem: requested.fileSystem } : {}),
      },
      scope: "turn",
    };
  }
  return { decision: "accept" };
}

function declineResponse(method: string): unknown {
  return method === "item/permissions/requestApproval"
    ? { permissions: {}, scope: "turn" }
    : { decision: "decline" };
}

function readConfiguredProfile(config: ConfigReadResponse): string | null {
  const value = (config.config as Record<string, unknown>).default_permissions;
  return typeof value === "string" ? value : null;
}

async function assertArtifacts(marker: string, network: string, markerText: string): Promise<void> {
  const actualMarker = await readFile(marker, "utf8");
  if (actualMarker !== markerText) {
    throw new Error(`${marker} 内容不匹配：${JSON.stringify(actualMarker)}`);
  }
  const networkStat = await stat(network);
  const body = await readFile(network, "utf8");
  if (networkStat.size === 0 || !body.includes("Example Domain")) {
    throw new Error(`${network} 未包含预期联网结果，size=${networkStat.size}`);
  }
}

async function assertMissing(target: string): Promise<void> {
  if (await exists(target)) throw new Error(`测试目录已存在，拒绝覆盖：${target}`);
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function printSummary(model: string, configuredProfile: string | null, scenarios: Scenario[]): void {
  console.log(`真实权限 E2E 通过：model=${model}，root=${testRoot}，configProfile=${configuredProfile ?? "legacy-defaults"}`);
  for (const active of scenarios) {
    const statuses = active.autoCompleted.map((item) => asRecord(asRecord(item.params).review).status);
    console.log(
      `${active.name}: approvals=${active.approvals.length}, autoReview=${statuses.length ? statuses.join(",") : "none"}, marker=${path.join(outside, `${active.name}-marker.txt`)}`,
    );
  }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function waitForListening(server: Server): Promise<void> {
  return server.listening ? Promise.resolve() : new Promise((resolve) => server.once("listening", resolve));
}

class RpcClient {
  private nextId = 1;
  private pending = new Map<number | string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private notificationListeners = new Set<(notification: Notification) => void>();
  private serverRequestListeners = new Set<(message: JsonRpcMessage) => void | Promise<void>>();

  constructor(private socket: WebSocket) {
    socket.on("message", (data) => void this.handleMessage(data.toString("utf8")));
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      void this.send({ id, method, params }).catch((error) => {
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.send({ method, params });
  }

  onNotification(listener: (notification: Notification) => void): void {
    this.notificationListeners.add(listener);
  }

  onServerRequest(listener: (message: JsonRpcMessage) => void | Promise<void>): void {
    this.serverRequestListeners.add(listener);
  }

  waitForNotification(predicate: (notification: Notification) => boolean, timeoutMs: number): Promise<Notification> {
    return new Promise((resolve, reject) => {
      const listener = (notification: Notification) => {
        if (!predicate(notification)) return;
        clearTimeout(timeout);
        this.notificationListeners.delete(listener);
        resolve(notification);
      };
      const timeout = setTimeout(() => {
        this.notificationListeners.delete(listener);
        reject(new Error(`等待 notification 超时：${timeoutMs}ms`));
      }, timeoutMs);
      this.notificationListeners.add(listener);
    });
  }

  respondResult(id: JsonRpcMessage["id"], result: unknown): void {
    if (id === undefined) return;
    void this.send({ id, result });
  }

  respondError(id: JsonRpcMessage["id"], code: number, message: string): void {
    if (id === undefined) return;
    void this.send({ id, error: { code, message } });
  }

  close(): void {
    this.socket.close();
  }

  private async send(message: unknown): Promise<void> {
    if (this.socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        this.socket.once("open", resolve);
        this.socket.once("error", reject);
      });
    }
    this.socket.send(JSON.stringify(message));
  }

  private async handleMessage(text: string): Promise<void> {
    const message = JSON.parse(text) as JsonRpcMessage;
    if (message.method && message.id !== undefined) {
      for (const listener of this.serverRequestListeners) await listener(message);
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error
        ? pending.reject(new Error(message.error.message ?? "JSON-RPC 请求失败"))
        : pending.resolve(message.result);
      return;
    }
    if (message.method) {
      const notification = { method: message.method, params: message.params };
      this.notificationListeners.forEach((listener) => listener(notification));
    }
  }
}

await main();
