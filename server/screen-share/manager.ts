import type { IncomingMessage } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import type { ScreenShareAuditEvent, ScreenShareAuditLogger, ScreenShareCapability, ScreenShareConfig } from "./types";
import { launchX11Vnc, type X11VncProcess } from "./x11vnc";
import { createRfbProxy, type RfbProxySession, type RfbServerInitInfo } from "./rfb-proxy";
import { probeScreenShareCapability } from "./probe";

export const SCREEN_SHARE_CLOSE_CODES = {
  ALREADY_ACTIVE: 4002,
  TAKEN_OVER: 4001,
  LAUNCH_FAILED: 4003,
  NORMAL: 1000,
} as const;

export const SCREEN_SHARE_CLOSE_REASONS = {
  ALREADY_ACTIVE: "already-active",
  TAKEN_OVER: "taken-over",
  LAUNCH_FAILED: "launch-failed",
  TAB_CLOSED: "tab-closed",
} as const;

export const defaultAuditLogger: ScreenShareAuditLogger = (event: ScreenShareAuditEvent) => {
  const remote = event.remoteAddress ?? "unknown";
  switch (event.type) {
    case "start":
      console.error(`[screen-share] start remote=${remote} port=${event.port}`);
      break;
    case "stop":
      console.error(
        `[screen-share] stop reason=${event.reason} remote=${remote} durationMs=${event.durationMs}`,
      );
      break;
    case "takeover":
      console.error(`[screen-share] takeover remote=${remote}`);
      break;
    case "rejected":
      console.error(`[screen-share] rejected reason=${event.reason} remote=${remote}`);
      break;
  }
};

export type ScreenShareManagerOptions = {
  config: ScreenShareConfig;
  auditLogger?: ScreenShareAuditLogger;
  launcher?: (options: { binaryPath: string; display: string }) => Promise<X11VncProcess>;
  probeFn?: (config: ScreenShareConfig) => ScreenShareCapability;
};

type ActiveSession = {
  ws: WebSocket;
  vncProcess: X11VncProcess;
  proxy: RfbProxySession;
  remoteAddress?: string;
  startTime: number;
  serverInitInfo?: RfbServerInitInfo;
};

export class ScreenShareManager {
  private readonly config: ScreenShareConfig;
  private readonly auditLogger: ScreenShareAuditLogger;
  private readonly launcher: (options: { binaryPath: string; display: string }) => Promise<X11VncProcess>;
  private readonly probeFn: (config: ScreenShareConfig) => ScreenShareCapability;
  private state: "idle" | "starting" | "active" | "stopping" = "idle";
  private activeSession: ActiveSession | null = null;
  private pendingStartingCancel: (() => void) | null = null;
  private closed = false;

  constructor(options: ScreenShareManagerOptions) {
    this.config = options.config;
    this.auditLogger = options.auditLogger ?? defaultAuditLogger;
    this.launcher = options.launcher ?? ((opts) => launchX11Vnc({ binaryPath: opts.binaryPath, display: opts.display }));
    this.probeFn = options.probeFn ?? probeScreenShareCapability;
  }

  public getStatus(): "idle" | "starting" | "active" | "stopping" {
    return this.state;
  }

  public getActiveResolution(): { width: number; height: number } | null {
    if (this.activeSession?.serverInitInfo) {
      return {
        width: this.activeSession.serverInitInfo.width,
        height: this.activeSession.serverInitInfo.height,
      };
    }
    return null;
  }

  public async handleConnection(ws: WebSocket, request: IncomingMessage): Promise<void> {
    const remoteAddress = request.socket.remoteAddress;
    const url = new URL(request.url ?? "/", "http://localhost");
    const isTakeover = url.searchParams.get("takeover") === "1" || url.searchParams.get("takeover") === "true";

    if (this.closed) {
      ws.close(1001, "server-shutting-down");
      return;
    }

    const capability = this.probeFn(this.config);
    if (capability.status !== "available") {
      const reason = capability.status === "disabled" ? "disabled" : capability.reason;
      this.auditLogger({ type: "rejected", remoteAddress, reason });
      ws.close(SCREEN_SHARE_CLOSE_CODES.LAUNCH_FAILED, reason);
      return;
    }

    // Check concurrency: if starting or active
    if (this.state !== "idle") {
      if (!isTakeover) {
        this.auditLogger({ type: "rejected", remoteAddress, reason: SCREEN_SHARE_CLOSE_REASONS.ALREADY_ACTIVE });
        ws.close(SCREEN_SHARE_CLOSE_CODES.ALREADY_ACTIVE, SCREEN_SHARE_CLOSE_REASONS.ALREADY_ACTIVE);
        return;
      }

      // Takeover requested: terminate current session
      this.auditLogger({ type: "takeover", remoteAddress });
      await this.terminateCurrentSession(
        SCREEN_SHARE_CLOSE_CODES.TAKEN_OVER,
        SCREEN_SHARE_CLOSE_REASONS.TAKEN_OVER,
      );
    }

    this.state = "starting";
    let cancelled = false;
    this.pendingStartingCancel = () => {
      cancelled = true;
    };

    let vncProc: X11VncProcess | null = null;
    try {
      vncProc = await this.launcher({
        binaryPath: this.config.x11vncPath || "x11vnc",
        display: capability.display,
      });

      if (cancelled || this.closed || ws.readyState !== ws.OPEN) {
        await vncProc.kill();
        this.state = "idle";
        return;
      }

      this.state = "active";
      this.pendingStartingCancel = null;
      const startTime = Date.now();

      this.auditLogger({ type: "start", remoteAddress, port: vncProc.port });

      const session: ActiveSession = {
        ws,
        vncProcess: vncProc,
        proxy: null as any,
        remoteAddress,
        startTime,
      };

      const proxy = createRfbProxy({
        vncHost: "127.0.0.1",
        vncPort: vncProc.port,
        vncPassword: vncProc.password,
        ws,
        onServerInit: (info) => {
          session.serverInitInfo = info;
        },
        onError: (err) => {
          void this.endSession(session, `proxy-error: ${err.message}`);
        },
        onClose: () => {
          void this.endSession(session, SCREEN_SHARE_CLOSE_REASONS.TAB_CLOSED);
        },
      });

      session.proxy = proxy;
      this.activeSession = session;

      vncProc.onExit((code, signal) => {
        void this.endSession(session, `x11vnc-exit: ${code ?? signal ?? "unknown"}`);
      });
    } catch (err) {
      this.state = "idle";
      this.pendingStartingCancel = null;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.auditLogger({ type: "rejected", remoteAddress, reason: errorMsg });
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.close(SCREEN_SHARE_CLOSE_CODES.LAUNCH_FAILED, errorMsg.slice(0, 100));
      }
    }
  }

  private async terminateCurrentSession(code: number, reason: string): Promise<void> {
    if (this.pendingStartingCancel) {
      this.pendingStartingCancel();
      this.pendingStartingCancel = null;
    }
    if (this.activeSession) {
      const session = this.activeSession;
      this.activeSession = null;
      this.state = "stopping";
      const durationMs = Date.now() - session.startTime;
      this.auditLogger({
        type: "stop",
        remoteAddress: session.remoteAddress,
        reason,
        durationMs,
      });

      try {
        if (session.ws.readyState === session.ws.OPEN) {
          session.ws.close(code, reason);
        }
      } catch {
        // ignore
      }

      try {
        session.proxy.close(code, reason);
      } catch {
        // ignore
      }

      await session.vncProcess.kill();
      this.state = "idle";
    }
  }

  private async endSession(session: ActiveSession, reason: string): Promise<void> {
    if (this.activeSession !== session) return;
    this.activeSession = null;
    this.state = "stopping";
    const durationMs = Date.now() - session.startTime;
    this.auditLogger({
      type: "stop",
      remoteAddress: session.remoteAddress,
      reason,
      durationMs,
    });

    try {
      if (session.ws.readyState === session.ws.OPEN) {
        session.ws.close(SCREEN_SHARE_CLOSE_CODES.NORMAL, reason);
      }
    } catch {
      // ignore
    }

    try {
      session.proxy.close(SCREEN_SHARE_CLOSE_CODES.NORMAL, reason);
    } catch {
      // ignore
    }

    await session.vncProcess.kill();
    this.state = "idle";
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.pendingStartingCancel) {
      this.pendingStartingCancel();
      this.pendingStartingCancel = null;
    }
    if (this.activeSession) {
      await this.terminateCurrentSession(1001, "bridge-shutdown");
    }
  }
}
