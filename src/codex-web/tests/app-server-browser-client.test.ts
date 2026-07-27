import { afterEach, describe, expect, it, vi } from "vitest";

import { AppServerBrowserClient } from "../app-server-browser-client";

type SocketListener = (event: { data?: unknown }) => void;

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static latest: FakeWebSocket | null = null;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  private listeners = new Map<string, SocketListener[]>();

  constructor(public readonly url: string) {
    FakeWebSocket.latest = this;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(): void {}

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  emit(type: string, event: { data?: unknown } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.WebSocket = originalWebSocket;
  FakeWebSocket.latest = null;
  FakeWebSocket.instances = [];
});

describe("AppServerBrowserClient connection close", () => {
  it("error 和随后 close 只上报一次断连", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const client = new AppServerBrowserClient("ws://127.0.0.1/bridge");
    const listener = vi.fn();
    client.onClose(listener);

    const connecting = client.connect();
    FakeWebSocket.latest?.open();
    await connecting;

    FakeWebSocket.latest?.emit("error");
    FakeWebSocket.latest?.emit("close");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual(new Error("Web bridge 连接失败"));
  });

  it("断线后允许创建新 WebSocket 重新连接", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const client = new AppServerBrowserClient("ws://127.0.0.1/bridge");

    const firstConnect = client.connect();
    FakeWebSocket.latest?.open();
    await firstConnect;
    const first = FakeWebSocket.latest;
    first?.emit("error");
    first?.close();

    const secondConnect = client.connect();
    const second = FakeWebSocket.latest;
    expect(second).not.toBe(first);
    second?.open();
    await secondConnect;
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("断线后使用最新 URL 创建 socket，并保留原 notification listener", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const client = new AppServerBrowserClient("ws://127.0.0.1/bridge?token=old");
    const listener = vi.fn();
    client.onNotification(listener);

    const firstConnect = client.connect();
    FakeWebSocket.latest?.open();
    await firstConnect;
    FakeWebSocket.latest?.emit("error");

    const secondConnect = client.connect("ws://127.0.0.1/bridge?token=new");
    const second = FakeWebSocket.latest;
    expect(second?.url).toBe("ws://127.0.0.1/bridge?token=new");
    second?.open();
    await secondConnect;
    second?.emit("message", {
      data: JSON.stringify({ method: "thread/started", params: { thread: { id: "thread-1" } } }),
    });

    expect(listener).toHaveBeenCalledWith({
      method: "thread/started",
      params: { thread: { id: "thread-1" } },
    });
  });

  it("活动 socket 已连接时拒绝切换到不同 URL", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const client = new AppServerBrowserClient("ws://127.0.0.1/bridge?token=old");

    const connecting = client.connect();
    FakeWebSocket.latest?.open();
    await connecting;

    await expect(
      client.connect("ws://127.0.0.1/bridge?token=new"),
    ).rejects.toThrow("Web bridge 已连接，不能切换地址");
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("主动关闭不会上报需要重连的断线", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const client = new AppServerBrowserClient("ws://127.0.0.1/bridge");
    const listener = vi.fn();
    client.onClose(listener);

    const connecting = client.connect();
    FakeWebSocket.latest?.open();
    await connecting;
    client.close();

    expect(listener).not.toHaveBeenCalled();
  });
});
