import type { Server } from "node:http";
import WebSocket from "ws";

import { createWebSocketBridge } from "../server/websocket-bridge";
import { appServerInitializeCapabilities } from "../src/codex-web/app-server-capabilities";

const requiredCodexHome = "/volume2/SSD/codex/Temp/codex-dev-home";

type Message = { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
type Notification = { method: string; params?: unknown };
type Settings = {
  approvalPolicy: unknown;
  approvalsReviewer: unknown;
  sandboxPolicy: { type?: string };
  activePermissionProfile?: { id?: string } | null;
};

async function main(): Promise<void> {
  if (process.env.CODEX_HOME !== requiredCodexHome) {
    throw new Error(`权限 smoke 必须使用隔离 CODEX_HOME：${requiredCodexHome}`);
  }

  const bridge = createWebSocketBridge({ token: "permission-policy-smoke-token" });
  try {
    await waitForListening(bridge.server);
    const client = new RpcClient(new WebSocket(`${bridge.url()}?token=${bridge.token}`));
    const initialize = await client.request("initialize", {
      clientInfo: { name: "codex_web_permission_smoke", title: "Codex Web Permission Smoke", version: "0.0.0" },
      capabilities: appServerInitializeCapabilities(),
    }) as { codexHome?: string };
    await client.notify("initialized");
    if (initialize.codexHome !== requiredCodexHome) throw new Error("app-server 使用了错误 CODEX_HOME");

    const models = await client.request("model/list", { includeHidden: false }) as {
      data?: Array<{ id: string; hidden?: boolean; isDefault?: boolean }>;
    };
    const model = models.data?.find((item) => !item.hidden && item.isDefault)?.id
      ?? models.data?.find((item) => !item.hidden)?.id;
    if (!model) throw new Error("model/list 没有返回可用模型");

    const cwd = process.cwd();
    const configured = await client.request("thread/start", {
      cwd,
      model,
      ephemeral: true,
      threadSource: "codex_web_permission_smoke",
      serviceName: "codex_web",
    }) as { thread?: { id?: string }; approvalPolicy: unknown; approvalsReviewer: unknown; sandbox: Settings["sandboxPolicy"]; activePermissionProfile?: Settings["activePermissionProfile"] };
    const threadId = configured.thread?.id;
    if (!threadId) throw new Error("thread/start 未返回 thread.id");

    await updateAndAssert(client, threadId, {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      permissions: ":workspace",
    }, "on-request", "auto_review", "workspaceWrite");
    await updateAndAssert(client, threadId, {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      permissions: ":workspace",
    }, "on-request", "user", "workspaceWrite");
    await updateAndAssert(client, threadId, {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      permissions: ":danger-full-access",
    }, "never", "user", "dangerFullAccess");

    const configuredProfile = configured.activePermissionProfile?.id;
    const configuredUpdate = configuredProfile
      ? {
          approvalPolicy: configured.approvalPolicy,
          approvalsReviewer: configured.approvalsReviewer,
          permissions: configuredProfile,
        }
      : {
          approvalPolicy: configured.approvalPolicy,
          approvalsReviewer: configured.approvalsReviewer,
          sandboxPolicy: configured.sandbox,
        };
    await updateAndAssert(
      client,
      threadId,
      configuredUpdate,
      configured.approvalPolicy,
      configured.approvalsReviewer,
      configured.sandbox.type,
    );

    client.close();
    console.log(`权限策略 smoke 通过：thread=${threadId}，model=${model}，configProfile=${configuredProfile ?? "legacy"}`);
  } finally {
    await bridge.close();
  }
}

async function updateAndAssert(
  client: RpcClient,
  threadId: string,
  params: Record<string, unknown>,
  approvalPolicy: unknown,
  approvalsReviewer: unknown,
  sandboxType: unknown,
): Promise<void> {
  const notification = client.waitForNotification(
    (item) => item.method === "thread/settings/updated" && (item.params as { threadId?: string } | undefined)?.threadId === threadId,
    10_000,
  );
  await client.request("thread/settings/update", { threadId, ...params });
  const settings = ((await notification).params as { threadSettings?: Settings }).threadSettings;
  if (!settings) throw new Error("thread/settings/updated 缺少 threadSettings");
  if (
    settings.approvalPolicy !== approvalPolicy
    || settings.approvalsReviewer !== approvalsReviewer
    || settings.sandboxPolicy.type !== sandboxType
  ) {
    throw new Error(`权限设置不匹配：${JSON.stringify(settings)}`);
  }
}

function waitForListening(server: Server): Promise<void> {
  return server.listening ? Promise.resolve() : new Promise((resolve) => server.once("listening", resolve));
}

class RpcClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private listeners = new Set<(notification: Notification) => void>();

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

  waitForNotification(predicate: (notification: Notification) => boolean, timeoutMs: number): Promise<Notification> {
    return new Promise((resolve, reject) => {
      const listener = (notification: Notification) => {
        if (!predicate(notification)) return;
        clearTimeout(timeout);
        this.listeners.delete(listener);
        resolve(notification);
      };
      const timeout = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`等待 thread/settings/updated 超时：${timeoutMs}ms`));
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
    const message = JSON.parse(text) as Message;
    if (message.method && message.id !== undefined) {
      this.socket.send(JSON.stringify({ id: message.id, error: { code: -32601, message: "权限 smoke 不处理 server request" } }));
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message ?? "JSON-RPC 请求失败")) : pending.resolve(message.result);
      return;
    }
    if (message.method) {
      const notification = { method: message.method, params: message.params };
      this.listeners.forEach((listener) => listener(notification));
    }
  }
}

await main();
