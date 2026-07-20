import type { Server } from "node:http";
import WebSocket from "ws";

import { createWebSocketBridge } from "../server/websocket-bridge";
import { appServerInitializeCapabilities } from "../src/codex-web/app-server-capabilities";

const requiredCodexHome = "/volume2/SSD/codex/Temp/codex-dev-home";

type JsonRpcMessage = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

type Notification = { method: string; params?: unknown };

async function main(): Promise<void> {
  if (process.env.CODEX_HOME !== requiredCodexHome) {
    throw new Error(`重连 smoke 必须使用隔离 CODEX_HOME：${requiredCodexHome}`);
  }

  const bridge = createWebSocketBridge({ token: "reconnect-smoke-token" });
  try {
    await waitForListening(bridge.server);
    const url = `${bridge.url()}?token=${bridge.token}`;
    const first = await RpcClient.connect(url);
    const initialize = await initializeClient(first);
    if (initialize.codexHome !== requiredCodexHome) {
      throw new Error(`app-server 使用了错误 CODEX_HOME：${initialize.codexHome ?? "缺失"}`);
    }

    const models = await first.request("model/list", { includeHidden: false }) as {
      data?: Array<{ id: string; hidden?: boolean; isDefault?: boolean }>;
    };
    const model = models.data?.find((item) => !item.hidden && item.isDefault)?.id
      ?? models.data?.find((item) => !item.hidden)?.id;
    if (!model) throw new Error("model/list 没有返回可用模型");

    const cwd = process.cwd();
    const startedThread = await first.request("thread/start", {
      cwd,
      model,
      ephemeral: false,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      threadSource: "codex_web_reconnect_smoke",
      serviceName: "codex_web",
    }) as { thread?: { id?: string } };
    const threadId = startedThread.thread?.id;
    if (!threadId) throw new Error("thread/start 未返回 thread.id");

    const commandStarted = first.waitForNotification((notification) => {
      const params = notification.params as { threadId?: string; item?: { type?: string } } | undefined;
      return notification.method === "item/started"
        && params?.threadId === threadId
        && params.item?.type === "commandExecution";
    }, 30_000, "等待长命令开始");
    const startedTurn = await first.request("turn/start", {
      threadId,
      cwd,
      model,
      input: [{
        type: "text",
        text: "请使用 shell 执行 sleep 12，命令结束后只回复 reconnect-ok。",
        text_elements: [],
      }],
    }) as { turn?: { id?: string } };
    const turnId = startedTurn.turn?.id;
    if (!turnId) throw new Error("turn/start 未返回 turn.id");
    await commandStarted;
    await first.close();

    const second = await RpcClient.connect(url);
    await initializeClient(second);
    const completed = second.waitForNotification((notification) => {
      const params = notification.params as { threadId?: string; turn?: { id?: string } } | undefined;
      return notification.method === "turn/completed"
        && params?.threadId === threadId
        && params.turn?.id === turnId;
    }, 30_000, "等待重连后的 turn/completed");
    const resumed = await second.request("thread/resume", { threadId }) as {
      thread?: { id?: string; turns?: Array<{ id?: string; status?: string }> };
    };
    const activeTurn = resumed.thread?.turns?.find((turn) => turn.id === turnId);
    if (resumed.thread?.id !== threadId || activeTurn?.status !== "inProgress") {
      throw new Error(
        `thread/resume 未恢复运行态：thread=${resumed.thread?.id ?? "缺失"}，status=${activeTurn?.status ?? "缺失"}`,
      );
    }

    const completedNotification = await completed;
    const completedStatus = (
      completedNotification.params as { turn?: { status?: string } } | undefined
    )?.turn?.status;
    if (completedStatus !== "completed") {
      throw new Error(`重连后的终态应为 completed，实际为 ${completedStatus ?? "缺失"}`);
    }

    const completedResume = await second.request("thread/resume", { threadId }) as {
      thread?: { turns?: Array<{ id?: string; status?: string }> };
    };
    const completedTurn = completedResume.thread?.turns?.find((turn) => turn.id === turnId);
    if (completedTurn?.status === "inProgress") {
      throw new Error("已完成 Turn 在再次 resume 后仍被标记为 inProgress");
    }

    await second.close();
    console.log(
      `重连 smoke 通过：CODEX_HOME=${initialize.codexHome}，thread=${threadId}，turn=${turnId}，恢复状态=inProgress，终态=${completedStatus}`,
    );
  } finally {
    await bridge.close();
  }
}

async function initializeClient(client: RpcClient): Promise<{ codexHome?: string }> {
  const response = await client.request("initialize", {
    clientInfo: { name: "codex_web_reconnect_smoke", title: "Codex Web Reconnect Smoke", version: "0.0.0" },
    capabilities: appServerInitializeCapabilities(),
  }) as { codexHome?: string };
  await client.notify("initialized");
  return response;
}

function waitForListening(server: Server): Promise<void> {
  return server.listening ? Promise.resolve() : new Promise((resolve) => server.once("listening", resolve));
}

class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private readonly listeners = new Set<(notification: Notification) => void>();

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
    socket.once("close", () => this.rejectAll(new Error("重连 smoke WebSocket 已关闭")));
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  notify(method: string, params?: unknown): Promise<void> {
    this.socket.send(JSON.stringify({ method, params }));
    return Promise.resolve();
  }

  waitForNotification(
    predicate: (notification: Notification) => boolean,
    timeoutMs: number,
    label: string,
  ): Promise<Notification> {
    return new Promise((resolve, reject) => {
      const listener = (notification: Notification) => {
        if (!predicate(notification)) return;
        clearTimeout(timeout);
        this.listeners.delete(listener);
        resolve(notification);
      };
      const timeout = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`${label}超时：${timeoutMs}ms`));
      }, timeoutMs);
      this.listeners.add(listener);
    });
  }

  close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once("close", resolve);
      this.socket.close();
    });
  }

  private handleMessage(text: string): void {
    const message = JSON.parse(text) as JsonRpcMessage;
    if (message.method && message.id !== undefined) {
      this.socket.send(JSON.stringify({
        id: message.id,
        error: { code: -32601, message: `重连 smoke 不处理 server request：${message.method}` },
      }));
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "JSON-RPC 请求失败"));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) {
      const notification = { method: message.method, params: message.params };
      this.listeners.forEach((listener) => listener(notification));
    }
  }

  private rejectAll(error: Error): void {
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
  }
}

await main();
