import type { JsonRpcId, JsonRpcNotification, JsonRpcRequest } from "@/codex/protocol/json-rpc";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class AppServerBrowserClient {
  private nextId = 1;
  private socket: WebSocket | null = null;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly notificationListeners = new Set<(notification: JsonRpcNotification) => void>();
  private readonly serverRequestListeners = new Set<(request: JsonRpcRequest) => void>();

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => this.handleMessage(event.data));
    this.socket.addEventListener("close", () => this.rejectAll(new Error("Web bridge 连接已关闭")));
    this.socket.addEventListener("error", () => this.rejectAll(new Error("Web bridge 连接失败")));

    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("Web bridge socket 未创建"));
        return;
      }
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("error", () => reject(new Error("Web bridge 连接失败")), { once: true });
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const message = params === undefined ? { id, method } : { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.send(message);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    const message = params === undefined ? { method } : { method, params };
    this.send(message);
  }

  onNotification(listener: (notification: JsonRpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onServerRequest(listener: (request: JsonRpcRequest) => void): () => void {
    this.serverRequestListeners.add(listener);
    return () => this.serverRequestListeners.delete(listener);
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.send({ id, result });
  }

  respondError(id: JsonRpcId, message: string): void {
    this.send({ id, error: { code: -32601, message } });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  private send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Web bridge 尚未连接");
    }
    this.socket.send(JSON.stringify(message));
  }

  private handleMessage(data: unknown): void {
    const text = typeof data === "string" ? data : String(data);
    const message = JSON.parse(text) as {
      id?: JsonRpcId;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message?: string };
    };

    if (message.method && message.id !== undefined) {
      const request = { id: message.id, method: message.method, params: message.params };
      for (const listener of this.serverRequestListeners) {
        listener(request);
      }
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "app-server request failed"));
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (message.method) {
      const notification = { method: message.method, params: message.params };
      for (const listener of this.notificationListeners) {
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
}
