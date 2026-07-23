import type { Server } from "node:http";
import WebSocket from "ws";

import { createWebSocketBridge } from "../server/websocket-bridge";
import { resolveTestCodexHome } from "../server/test-codex-home";
import { appServerInitializeCapabilities } from "../src/codex-web/app-server-capabilities";
import { withPlanCollaborationMode } from "../src/codex-web/app-server-collaboration-mode";

const codexHome = resolveTestCodexHome();
process.env.CODEX_HOME = codexHome;
const verifier = `goal-plan-plus-smoke-${Date.now()}`;

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
  const bridge = createWebSocketBridge({ token: "goal-plan-smoke-token" });

  try {
    await waitForListening(bridge.server);
    const socket = new WebSocket(`${bridge.url()}?token=${bridge.token}`);
    const client = new WebSocketRpcClient(socket);

    const initialize = await client.request("initialize", {
      clientInfo: { name: "codex_web_goal_plan_smoke", title: "Codex Web Goal/Plan Smoke", version: "0.0.0" },
      capabilities: appServerInitializeCapabilities(),
    }) as { codexHome?: string };
    await client.notify("initialized");

    if (initialize.codexHome !== codexHome) {
      throw new Error(`app-server 使用了错误 CODEX_HOME：${initialize.codexHome}`);
    }

    const models = await client.request("model/list", { includeHidden: false }) as {
      data?: Array<{ id: string; hidden?: boolean; isDefault?: boolean }>;
    };
    const model =
      models.data?.find((item) => !item.hidden && item.isDefault)?.id ??
      models.data?.find((item) => !item.hidden)?.id;
    if (!model) {
      throw new Error("model/list 没有返回可用模型");
    }

    const cwd = process.cwd();
    const threadResponse = await client.request("thread/start", {
      cwd,
      model,
      approvalPolicy: "on-request",
      threadSource: "codex_web_goal_plan_smoke",
      serviceName: "codex_web",
    }) as { thread?: { id?: string } };
    const threadId = threadResponse.thread?.id;
    if (!threadId) {
      throw new Error("thread/start 未返回 thread.id");
    }

    const goalObjective = `浏览器目标 smoke ${verifier}`;
    await client.request("thread/goal/set", {
      threadId,
      objective: goalObjective,
      status: "active",
    });
    const goalResponse = await client.request("thread/goal/get", { threadId }) as {
      goal?: { objective?: string; status?: string } | null;
    };
    if (goalResponse.goal?.objective !== goalObjective || goalResponse.goal.status !== "active") {
      throw new Error(`goal 未写入预期值：${JSON.stringify(goalResponse.goal)}`);
    }

    const planPrompt = `请在 Plan mode 下生成一个两步 proposed plan，验证码 ${verifier}。不要修改文件，不要运行命令。`;
    const planNotification = waitForNotification(
      client,
      (notification) =>
        notification.method === "turn/plan/updated" ||
        notification.method === "item/plan/delta" ||
        (
          notification.method === "item/completed" &&
          JSON.stringify(notification.params ?? {}).includes("<proposed_plan>") &&
          JSON.stringify(notification.params ?? {}).includes(verifier)
        ),
      180_000,
    );

    const turnParams = withPlanCollaborationMode({
      threadId,
      input: [{ type: "text", text: planPrompt, text_elements: [] }],
      cwd,
      model,
      approvalPolicy: "on-request",
    }, "plan", model);
    await client.request("turn/start", turnParams);
    const notification = await planNotification;

    socket.close();
    console.log(
      `goal/plan smoke 通过：CODEX_HOME=${initialize.codexHome}，thread=${threadId}，model=${model}，verifier=${verifier}，planSource=${notification.method}`,
    );
  } finally {
    await bridge.close();
  }
}

function waitForListening(server: Server): Promise<void> {
  if (server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve) => server.once("listening", resolve));
}

function waitForNotification(
  client: WebSocketRpcClient,
  predicate: (notification: Notification) => boolean,
  timeoutMs: number,
): Promise<Notification> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(
        `等待 app-server notification 超时：${timeoutMs}ms\n最近消息：\n${client.recentMessages.join("\n")}`,
      ));
    }, timeoutMs);

    const unsubscribe = client.onNotification((notification) => {
      if (!predicate(notification)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(notification);
    });
  });
}

class WebSocketRpcClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly listeners = new Set<(notification: Notification) => void>();
  readonly recentMessages: string[] = [];

  constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => this.handleMessage(data.toString("utf8")));
    socket.once("error", (error) => this.rejectAll(error));
    socket.once("close", () => this.rejectAll(new Error("goal/plan smoke WebSocket 已关闭")));
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const message = params === undefined ? { id, method } : { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send(message).catch((error: Error) => {
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const message = params === undefined ? { method } : { method, params };
    await this.send(message);
  }

  onNotification(listener: (notification: Notification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
    this.rememberMessage(message);

    if (message.method && message.id !== undefined) {
      this.socket.send(JSON.stringify({
        id: message.id,
        error: {
          code: -32601,
          message: `goal/plan smoke 暂不支持 app-server server request: ${message.method}`,
        },
      }));
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "JSON-RPC 请求失败"));
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (message.method) {
      const notification = { method: message.method, params: message.params };
      for (const listener of this.listeners) {
        listener(notification);
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private rememberMessage(message: JsonRpcMessage): void {
    const summary = message.method
      ? `${message.id !== undefined ? "server-request" : "notification"} ${message.method} ${JSON.stringify(message.params ?? {}).slice(0, 500)}`
      : message.id !== undefined
        ? `response ${message.id} ${message.error ? `error=${message.error.message}` : "ok"}`
        : JSON.stringify(message).slice(0, 500);
    this.recentMessages.push(summary);
    if (this.recentMessages.length > 20) {
      this.recentMessages.splice(0, this.recentMessages.length - 20);
    }
  }
}

await main();
