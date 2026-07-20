import { afterEach, describe, expect, it, vi } from "vitest";

import { AppServerBrowserClient } from "./app-server-browser-client";

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

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({});
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
