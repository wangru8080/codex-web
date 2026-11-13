import http from "node:http";
import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import { createWebSocketBridge } from "../websocket-bridge";

describe("websocket-bridge screen share security & routing parity", () => {
  it("rejects upgrade to /screen-share/ws when token is invalid (401)", async () => {
    const bridge = createWebSocketBridge({
      port: 0,
      host: "127.0.0.1",
      token: "secret-token",
      screenShare: { enabled: true, wsPath: "/screen-share/ws" },
    });
    await new Promise<void>((r) => bridge.server.listen(0, "127.0.0.1", r));
    const addr = bridge.server.address() as import("node:net").AddressInfo;

    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/screen-share/ws?token=wrong-token`, {
      origin: "http://localhost:3000",
    });

    const statusCode = await new Promise<number | undefined>((resolve) => {
      ws.on("unexpected-response", (_req, res) => {
        resolve(res.statusCode);
      });
      ws.on("error", () => {});
    });

    expect(statusCode).toBe(401);
    await bridge.close();
  });

  it("rejects upgrade to /screen-share/ws when origin is not allowed (403)", async () => {
    const bridge = createWebSocketBridge({
      port: 0,
      host: "127.0.0.1",
      token: "secret-token",
      allowedOrigins: ["http://localhost:3000"],
      screenShare: { enabled: true, wsPath: "/screen-share/ws" },
    });
    await new Promise<void>((r) => bridge.server.listen(0, "127.0.0.1", r));
    const addr = bridge.server.address() as import("node:net").AddressInfo;

    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/screen-share/ws?token=secret-token`, {
      origin: "http://evil.com",
    });

    const statusCode = await new Promise<number | undefined>((resolve) => {
      ws.on("unexpected-response", (_req, res) => {
        resolve(res.statusCode);
      });
      ws.on("error", () => {});
    });

    expect(statusCode).toBe(403);
    await bridge.close();
  });

  it("allows upgrade to /screen-share/ws when security checks pass", async () => {
    const handleConnectionSpy = vi.spyOn(
      createWebSocketBridge.prototype ?? Object,
      "toString"
    );
    const bridge = createWebSocketBridge({
      port: 0,
      host: "127.0.0.1",
      token: "secret-token",
      screenShare: {
        enabled: true,
        wsPath: "/screen-share/ws",
        probeFn: () => ({ status: "available", display: ":0", wsPath: "/screen-share/ws" }),
        launcher: async () => ({
          pid: 99,
          port: 5900,
          password: "test",
          display: ":0",
          getStderrSummary: () => "",
          kill: async () => {},
          onExit: () => {},
        }),
      },
    });
    await new Promise<void>((r) => bridge.server.listen(0, "127.0.0.1", r));
    const addr = bridge.server.address() as import("node:net").AddressInfo;

    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/screen-share/ws?token=secret-token`, {
      origin: "http://localhost:3000",
    });

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
      ws.on("unexpected-response", (_req, res) => reject(new Error(`Status ${res.statusCode}`)));
    });

    expect(bridge.screenShareManager.getStatus()).toBe("active");
    ws.close();
    await bridge.close();
  });
});
