import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import { observeBridgeSocket } from "../bridge-connection-diagnostics";

class FakeWebSocket extends EventEmitter {}

describe("bridge connection diagnostics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs peer, close code, reason, and duration without request credentials", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const socket = new FakeWebSocket() as unknown as WebSocket;
    const request = {
      socket: { remoteAddress: "203.0.113.8" },
      headers: { "user-agent": "CodexWebAndroid/0.1" },
    } as unknown as IncomingMessage;

    observeBridgeSocket("bridge", socket, request);
    (socket as unknown as FakeWebSocket).emit("error", new Error("reset"));
    (socket as unknown as FakeWebSocket).emit("close", 1006, Buffer.from("network lost"));

    expect(info).toHaveBeenNthCalledWith(
      1,
      '[bridge] socket connected remote=203.0.113.8 userAgent="CodexWebAndroid/0.1"',
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[bridge] socket error remote=203.0.113.8"),
    );
    expect(info).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        '[bridge] socket closed remote=203.0.113.8 code=1006 reason="network lost" durationMs=',
      ),
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("token=");
  });
});
