import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  SCREEN_SHARE_CLOSE_CODES,
  SCREEN_SHARE_CLOSE_REASONS,
  ScreenShareManager,
} from "../screen-share/manager";
import type { ScreenShareAuditEvent, ScreenShareConfig } from "../screen-share/types";
import type { X11VncProcess } from "../screen-share/x11vnc";

function createMockWs() {
  const ws = new EventEmitter() as any;
  ws.readyState = 1; // OPEN
  ws.OPEN = 1;
  ws.CONNECTING = 0;
  ws.bufferedAmount = 0;
  ws.send = vi.fn();
  ws.close = vi.fn((code: number, reason: string) => {
    ws.readyState = 3; // CLOSED
    ws.emit("close", code, reason);
  });
  return ws;
}

function createMockLauncher() {
  let killed = false;
  const exitCallbacks = new Set<(code: number | null, signal: any) => void>();
  const mockProc: X11VncProcess = {
    pid: 12345,
    port: 5900,
    password: "mockpassword",
    display: ":0",
    getStderrSummary: () => "",
    kill: vi.fn(async () => {
      killed = true;
      for (const cb of exitCallbacks) cb(0, "SIGTERM");
    }),
    onExit: (cb) => {
      exitCallbacks.add(cb);
    },
  };

  return {
    launcher: vi.fn(async () => mockProc),
    mockProc,
  };
}

describe("screen-share manager", () => {
  const config: ScreenShareConfig = {
    enabled: true,
    display: ":0",
    wsPath: "/screen-share/ws",
  };

  it("launches session on connection when available", async () => {
    const { launcher, mockProc } = createMockLauncher();
    const auditEvents: ScreenShareAuditEvent[] = [];
    const manager = new ScreenShareManager({
      config,
      launcher,
      auditLogger: (e) => auditEvents.push(e),
      probeFn: () => ({ status: "available", display: ":0", wsPath: "/screen-share/ws" }),
    });

    const ws = createMockWs();
    const req = {
      socket: { remoteAddress: "127.0.0.1" },
      url: "/screen-share/ws",
    } as IncomingMessage;

    await manager.handleConnection(ws, req);

    expect(manager.getStatus()).toBe("active");
    expect(launcher).toHaveBeenCalledOnce();
    expect(auditEvents.some((e) => e.type === "start")).toBe(true);

    await manager.close();
    expect(mockProc.kill).toHaveBeenCalled();
  });

  it("rejects second connection with ALREADY_ACTIVE when takeover not set", async () => {
    const { launcher } = createMockLauncher();
    const auditEvents: ScreenShareAuditEvent[] = [];
    const manager = new ScreenShareManager({
      config,
      launcher,
      auditLogger: (e) => auditEvents.push(e),
      probeFn: () => ({ status: "available", display: ":0", wsPath: "/screen-share/ws" }),
    });

    const ws1 = createMockWs();
    const req1 = { socket: { remoteAddress: "127.0.0.1" }, url: "/screen-share/ws" } as IncomingMessage;
    await manager.handleConnection(ws1, req1);

    const ws2 = createMockWs();
    const req2 = { socket: { remoteAddress: "127.0.0.1" }, url: "/screen-share/ws" } as IncomingMessage;
    await manager.handleConnection(ws2, req2);

    expect(ws2.close).toHaveBeenCalledWith(
      SCREEN_SHARE_CLOSE_CODES.ALREADY_ACTIVE,
      SCREEN_SHARE_CLOSE_REASONS.ALREADY_ACTIVE,
    );
    expect(auditEvents.some((e) => e.type === "rejected" && e.reason === "already-active")).toBe(true);

    await manager.close();
  });

  it("handles takeover when takeover=1 query param is supplied", async () => {
    const { launcher, mockProc } = createMockLauncher();
    const auditEvents: ScreenShareAuditEvent[] = [];
    const manager = new ScreenShareManager({
      config,
      launcher,
      auditLogger: (e) => auditEvents.push(e),
      probeFn: () => ({ status: "available", display: ":0", wsPath: "/screen-share/ws" }),
    });

    const ws1 = createMockWs();
    const req1 = { socket: { remoteAddress: "127.0.0.1" }, url: "/screen-share/ws" } as IncomingMessage;
    await manager.handleConnection(ws1, req1);

    const ws2 = createMockWs();
    const req2 = { socket: { remoteAddress: "127.0.0.1" }, url: "/screen-share/ws?takeover=1" } as IncomingMessage;
    await manager.handleConnection(ws2, req2);

    // ws1 should be closed with TAKEN_OVER
    expect(ws1.close).toHaveBeenCalledWith(
      SCREEN_SHARE_CLOSE_CODES.TAKEN_OVER,
      SCREEN_SHARE_CLOSE_REASONS.TAKEN_OVER,
    );
    expect(auditEvents.some((e) => e.type === "takeover")).toBe(true);
    expect(manager.getStatus()).toBe("active");

    await manager.close();
  });

  it("rejects connection when capability probe returns unsupported or disabled", async () => {
    const { launcher } = createMockLauncher();
    const auditEvents: ScreenShareAuditEvent[] = [];
    const manager = new ScreenShareManager({
      config,
      launcher,
      auditLogger: (e) => auditEvents.push(e),
      probeFn: () => ({ status: "unsupported", reason: "Linux X11 only" }),
    });

    const ws = createMockWs();
    const req = { socket: { remoteAddress: "127.0.0.1" }, url: "/screen-share/ws" } as IncomingMessage;
    await manager.handleConnection(ws, req);

    expect(ws.close).toHaveBeenCalledWith(SCREEN_SHARE_CLOSE_CODES.LAUNCH_FAILED, "Linux X11 only");
    expect(launcher).not.toHaveBeenCalled();
  });
});
