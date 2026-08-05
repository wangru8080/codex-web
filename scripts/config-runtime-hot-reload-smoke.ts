import type { Server } from "node:http";
import WebSocket from "ws";

import { createWebSocketBridge } from "../server/websocket-bridge";
import { resolveTestCodexHome } from "../server/test-codex-home";
import { appServerInitializeCapabilities } from "../src/codex-web/app-server-capabilities";
import { applyConfigRuntimeEdits } from "../src/codex-web/config-runtime-refresh";
import { mcpServersFromConfigValue, mcpServersToConfigValue } from "../src/codex-web/mcp-config-adapter";

const codexHome = resolveTestCodexHome();
process.env.CODEX_HOME = codexHome;

type Message = { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
type Model = {
  id: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
};
type ThreadSettingsResponse = {
  thread: { id: string };
  model: string;
  reasoningEffort: string | null;
};

async function main(): Promise<void> {
  const bridge = createWebSocketBridge({ token: "config-runtime-hot-reload-smoke-token" });
  try {
    await waitForListening(bridge.server);
    const client = new RpcClient(new WebSocket(`${bridge.url()}?token=${bridge.token}`));
    const initialize = await client.request("initialize", {
      clientInfo: { name: "codex_web_config_runtime_smoke", title: "Codex Web Config Runtime Smoke", version: "0.0.0" },
      capabilities: appServerInitializeCapabilities(),
    }) as { codexHome?: string };
    await client.notify("initialized");
    if (initialize.codexHome !== codexHome) throw new Error("app-server 使用了错误 CODEX_HOME");

    const currentConfig = await client.request("config/read", {
      includeLayers: false,
      cwd: null,
    }) as { config: Record<string, unknown> };

    const modelList = await client.request("model/list", { includeHidden: false }) as { data: Model[] };
    const models = modelList.data.filter((item) => !item.hidden);
    const sessionModel = models.find((item) => item.isDefault) ?? models[0];
    if (!sessionModel) throw new Error("model/list 没有返回可用模型");
    const sessionEffort = sessionModel.supportedReasoningEfforts[0]?.reasoningEffort
      ?? sessionModel.defaultReasoningEffort;

    const started = await client.request("thread/start", {
      cwd: process.cwd(),
      model: sessionModel.id,
      config: { model_reasoning_effort: sessionEffort },
      threadSource: "codex_web_config_runtime_smoke",
      serviceName: "codex_web",
    }) as ThreadSettingsResponse;
    if (!started.thread.id) throw new Error("thread/start 未返回 thread.id");

    const turn = await client.request("turn/start", {
      threadId: started.thread.id,
      cwd: process.cwd(),
      model: sessionModel.id,
      effort: sessionEffort,
      input: [{ type: "text", text: "配置热加载 smoke 会话持久化消息。", text_elements: [] }],
    }) as { turn?: { id?: string } };
    if (!turn.turn?.id) throw new Error("turn/start 未返回 turn.id");
    const persisted = await waitForResume(client, started.thread.id, 10_000);
    try {
      await client.request("turn/interrupt", { threadId: started.thread.id, turnId: turn.turn.id });
    } catch {
      // turn 可能在中断请求到达前已经完成。
    }

    const configuredModel = typeof currentConfig.config.model === "string"
      ? currentConfig.config.model
      : sessionModel.id;
    const configuredEffort = typeof currentConfig.config.model_reasoning_effort === "string"
      ? currentConfig.config.model_reasoning_effort
      : sessionModel.defaultReasoningEffort;
    const defaultMethods: string[] = [];
    await applyConfigRuntimeEdits(async (method, params) => {
      defaultMethods.push(method);
      return client.request(method, params);
    }, [
      { keyPath: "model", value: configuredModel, mergeStrategy: "replace" },
      { keyPath: "model_reasoning_effort", value: configuredEffort, mergeStrategy: "replace" },
    ]);
    assertMethods(defaultMethods, ["config/batchWrite", "config/read"], "默认值写入");

    const resumed = await client.request("thread/resume", { threadId: started.thread.id }) as ThreadSettingsResponse;
    if (resumed.model !== persisted.model || resumed.reasoningEffort !== persisted.reasoningEffort) {
      throw new Error(`默认值写入改变了已有 thread：before=${JSON.stringify(persisted)} after=${JSON.stringify(resumed)}`);
    }

    const mcpMethods: string[] = [];
    await applyConfigRuntimeEdits(async (method, params) => {
      mcpMethods.push(method);
      return client.request(method, params);
    }, [{
      keyPath: "mcp_servers",
      value: mcpServersToConfigValue(mcpServersFromConfigValue(readRecord(currentConfig.config.mcp_servers))),
      mergeStrategy: "replace",
    }]);
    assertMethods(mcpMethods, ["config/batchWrite", "config/mcpServer/reload", "config/read"], "MCP 写入");

    await client.request("thread/archive", { threadId: started.thread.id });
    client.close();
    console.log(`配置热加载 smoke 通过：thread=${started.thread.id}，model=${persisted.model}，effort=${persisted.reasoningEffort ?? "null"}，CODEX_HOME=${codexHome}`);
  } finally {
    await bridge.close();
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function assertMethods(actual: string[], expected: string[], label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}请求顺序错误：${JSON.stringify(actual)}`);
  }
}

function waitForListening(server: Server): Promise<void> {
  return server.listening ? Promise.resolve() : new Promise((resolve) => server.once("listening", resolve));
}

async function waitForResume(client: RpcClient, threadId: string, timeoutMs: number): Promise<ThreadSettingsResponse> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await client.request("thread/resume", { threadId }) as ThreadSettingsResponse;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`等待 rollout 可恢复超时：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

class RpcClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private socket: WebSocket) {
    socket.on("message", (data) => this.handleMessage(data.toString("utf8")));
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params }).catch(reject);
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.send({ method, params });
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

  private handleMessage(text: string): void {
    const message = JSON.parse(text) as Message;
    if (message.method && message.id !== undefined) {
      this.socket.send(JSON.stringify({ id: message.id, error: { code: -32601, message: "配置 smoke 不处理 server request" } }));
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    message.error ? pending.reject(new Error(message.error.message ?? "JSON-RPC 请求失败")) : pending.resolve(message.result);
  }
}

await main();
