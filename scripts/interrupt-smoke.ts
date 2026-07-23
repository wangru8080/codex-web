import type { Server } from "node:http";
import WebSocket from "ws";

import { createWebSocketBridge } from "../server/websocket-bridge";
import { resolveTestCodexHome } from "../server/test-codex-home";
import { appServerInitializeCapabilities } from "../src/codex-web/app-server-capabilities";

const codexHome = resolveTestCodexHome();
process.env.CODEX_HOME = codexHome;

type JsonRpcMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

type Notification = {
  method: string;
  params?: unknown;
};

async function main(): Promise<void> {
  const bridge = createWebSocketBridge({ token: "interrupt-smoke-token" });
  try {
    await waitForListening(bridge.server);
    const client = new RpcClient(new WebSocket(`${bridge.url()}?token=${bridge.token}`));
    const initialize = await client.request("initialize", {
      clientInfo: { name: "codex_web_interrupt_smoke", title: "Codex Web Interrupt Smoke", version: "0.0.0" },
      capabilities: appServerInitializeCapabilities(),
    }) as { codexHome?: string };
    await client.notify("initialized");
    if (initialize.codexHome !== codexHome) {
      throw new Error(`app-server 使用了错误 CODEX_HOME：${initialize.codexHome}`);
    }

    const models = await client.request("model/list", { includeHidden: false }) as {
      data?: Array<{ id: string; hidden?: boolean; isDefault?: boolean }>;
    };
    const model = models.data?.find((item) => !item.hidden && item.isDefault)?.id
      ?? models.data?.find((item) => !item.hidden)?.id;
    if (!model) throw new Error("model/list 没有返回可用模型");

    const cwd = process.cwd();
    const thread = await client.request("thread/start", {
      cwd,
      model,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      threadSource: "codex_web_interrupt_smoke",
      serviceName: "codex_web",
    }) as { thread?: { id?: string } };
    const threadId = thread.thread?.id;
    if (!threadId) throw new Error("thread/start 未返回 thread.id");

    const commandStarted = client.waitForNotification((notification) => {
      if (notification.method !== "item/started") return false;
      const params = notification.params as {
        threadId?: string;
        item?: { type?: string };
      } | undefined;
      return params?.threadId === threadId && params.item?.type === "commandExecution";
    }, 30_000);
    const started = await client.request("turn/start", {
      threadId,
      cwd,
      model,
      input: [{ type: "text", text: "请使用 shell 执行 sleep 30，等待完成后只回复 done。", text_elements: [] }],
    }) as { turn?: { id?: string } };
    const turnId = started.turn?.id;
    if (!turnId) throw new Error("turn/start 未返回 turn.id");

    await commandStarted;

    const completed = client.waitForNotification((notification) => {
      if (notification.method !== "turn/completed") return false;
      const params = notification.params as { threadId?: string; turn?: { id?: string } } | undefined;
      return params?.threadId === threadId && params.turn?.id === turnId;
    }, 30_000);
    await client.request("turn/interrupt", { threadId, turnId });

    const notification = await completed;
    const status = (notification.params as { turn?: { status?: string } } | undefined)?.turn?.status;
    if (status !== "interrupted") {
      throw new Error(`turn/completed 状态应为 interrupted，实际为 ${status ?? "缺失"}`);
    }

    client.close();
    console.log(
      `中断 smoke 通过：CODEX_HOME=${initialize.codexHome}，thread=${threadId}，turn=${turnId}，status=${status}`,
    );
  } finally {
    await bridge.close();
  }
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

  constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => this.handleMessage(data.toString("utf8")));
    socket.once("error", (error) => this.rejectAll(error));
    socket.once("close", () => this.rejectAll(new Error("中断 smoke WebSocket 已关闭")));
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params }).catch((error: Error) => {
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.send({ method, params });
  }

  waitForNotification(
    predicate: (notification: Notification) => boolean,
    timeoutMs: number,
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
        reject(new Error(`等待 turn/completed 超时：${timeoutMs}ms`));
      }, timeoutMs);
      this.listeners.add(listener);
    });
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
    const message = JSON.parse(text) as JsonRpcMessage;
    if (message.method && message.id !== undefined) {
      this.socket.send(JSON.stringify({
        id: message.id,
        error: { code: -32601, message: `中断 smoke 不处理 server request：${message.method}` },
      }));
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "JSON-RPC 请求失败"));
      } else {
        pending.resolve(message.result);
      }
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
