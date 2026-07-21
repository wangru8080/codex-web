import type { Server } from "node:http";
import WebSocket from "ws";

import { appServerInitializeCapabilities } from "../src/codex-web/app-server-capabilities";
import type { JsonRpcMessage } from "../src/codex/protocol/json-rpc";
import { isolatedCodexHome } from "../server/codex-process";
import { createWebSocketBridge } from "../server/websocket-bridge";

if (process.env.CODEX_HOME !== isolatedCodexHome) {
  console.error(
    `app-server recovery smoke 必须使用隔离 CODEX_HOME：${isolatedCodexHome}，当前为 ${process.env.CODEX_HOME ?? "未设置"}`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const bridge = createWebSocketBridge({
    host: "127.0.0.1",
    allowRemoteConnections: true,
    codexHome: isolatedCodexHome,
  });
  try {
    await waitForListening(bridge.server);
    const url = `${bridge.url()}?token=${bridge.token}`;
    const firstPid = requiredPid(bridge.appServerPid, "第一代");
    const first = await RpcClient.connect(url);
    const firstInitialize = await initializeClient(first);
    assertIsolatedHome(firstInitialize.codexHome);
    const firstModels = await listModels(first);
    const firstClosed = first.waitForClose();

    process.kill(firstPid, "SIGKILL");

    await firstClosed;
    await waitFor(() => bridge.appServerPid !== undefined && bridge.appServerPid !== firstPid, 10_000);
    const secondPid = requiredPid(bridge.appServerPid, "第二代");
    if (!first.notifications.some((message) => message.method === "bridge/error")) {
      throw new Error("fatal exit 前未收到 bridge/error 诊断");
    }

    const second = await RpcClient.connect(url);
    const secondInitialize = await initializeClient(second);
    assertIsolatedHome(secondInitialize.codexHome);
    const secondModels = await listModels(second);

    await second.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (bridge.appServerPid !== secondPid) {
      throw new Error("仅关闭浏览器 WebSocket 时 app-server PID 不应改变");
    }

    console.log(
      `app-server recovery smoke 通过：CODEX_HOME=${secondInitialize.codexHome}，旧 PID=${firstPid}，新 PID=${secondPid}，模型=${firstModels}/${secondModels}，普通断线 PID 保持不变`,
    );
  } finally {
    await bridge.close();
  }
}

async function initializeClient(client: RpcClient): Promise<{ codexHome?: string }> {
  const response = await client.request("initialize", {
    clientInfo: {
      name: "codex_web_app_server_recovery_smoke",
      title: "Codex Web App-Server Recovery Smoke",
      version: "0.0.0",
    },
    capabilities: appServerInitializeCapabilities(),
  }) as { codexHome?: string };
  client.notify("initialized");
  return response;
}

async function listModels(client: RpcClient): Promise<number> {
  const response = await client.request("model/list", { includeHidden: false }) as {
    data?: unknown[];
  };
  if (!response.data || response.data.length === 0) {
    throw new Error("model/list 未返回可用模型");
  }
  return response.data.length;
}

function assertIsolatedHome(codexHome: string | undefined): void {
  if (codexHome !== isolatedCodexHome) {
    throw new Error(`app-server 使用了错误 CODEX_HOME：${codexHome ?? "缺失"}`);
  }
}

function requiredPid(pid: number | undefined, label: string): number {
  if (pid === undefined) throw new Error(`${label} app-server PID 缺失`);
  return pid;
}

function waitForListening(server: Server): Promise<void> {
  return server.listening ? Promise.resolve() : new Promise((resolve) => server.once("listening", resolve));
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`等待 app-server 恢复超时：${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

class RpcClient {
  readonly notifications: Array<{ method: string; params?: unknown }> = [];
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  static async connect(url: string): Promise<RpcClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new RpcClient(socket);
  }

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => this.handleMessage(data.toString("utf8")));
    socket.once("error", (error) => this.rejectAll(error));
    socket.once("close", () => this.rejectAll(new Error("recovery smoke WebSocket 已关闭")));
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  notify(method: string, params?: unknown): void {
    this.socket.send(JSON.stringify({ method, params }));
  }

  waitForClose(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => this.socket.once("close", () => resolve()));
  }

  close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once("close", () => resolve());
      this.socket.close();
    });
  }

  private handleMessage(text: string): void {
    const message = JSON.parse(text) as JsonRpcMessage;
    if ("method" in message && message.id !== undefined) {
      this.socket.send(JSON.stringify({
        id: message.id,
        error: { code: -32601, message: `recovery smoke 不处理 server request：${message.method}` },
      }));
      return;
    }
    if (!("method" in message)) {
      const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
      if (!pending) return;
      this.pending.delete(message.id as number);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    this.notifications.push({ method: message.method, params: message.params });
  }

  private rejectAll(error: Error): void {
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
  }
}

await main();
