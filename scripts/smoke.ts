import type { Server } from "node:http";
import WebSocket from "ws";

import { AppServerSession } from "../server/app-server-session";
import { resolveTestCodexHome } from "../server/test-codex-home";
import { createWebSocketBridge } from "../server/websocket-bridge";

const codexHome = resolveTestCodexHome();
process.env.CODEX_HOME = codexHome;

async function main(): Promise<void> {
  const bridge = createWebSocketBridge({ token: "smoke-token" });

  try {
    await waitForListening(bridge.server);
    const socket = new WebSocket(`${bridge.url()}?token=${bridge.token}`);
    const session = new AppServerSession(new WebSocketRpcClient(socket));
    const response = await session.bootstrap();

    if (response.initialize.data.codexHome !== codexHome) {
      throw new Error(`app-server 使用了错误 CODEX_HOME：${response.initialize.data.codexHome}`);
    }

    socket.close();
    console.log(
      `smoke bridge 通过：CODEX_HOME=${response.initialize.data.codexHome}，models=${response.models.data.data.length}，accountSource=${response.account.source}`,
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

class WebSocketRpcClient extends EventTarget {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(private readonly socket: WebSocket) {
    super();
    socket.on("message", (data) => this.handleMessage(data.toString("utf8")));
    socket.once("error", (error) => this.rejectAll(error));
    socket.once("close", () => this.rejectAll(new Error("smoke WebSocket 已关闭")));
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

  onNotification(listener: (notification: { method: string; params?: unknown }) => void): void {
    this.addEventListener("notification", (event) => listener((event as CustomEvent).detail));
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
    const message = JSON.parse(text) as {
      id?: number;
      method?: string;
      result?: unknown;
      error?: { message?: string };
      params?: unknown;
    };

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
      this.dispatchEvent(new CustomEvent("notification", { detail: message }));
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

await main();
