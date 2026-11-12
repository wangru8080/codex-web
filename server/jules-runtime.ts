import WebSocket from "ws";

import { appServerInitializeCapabilities } from "../src/codex-web/app-server-capabilities";
import { APP_VERSION } from "../src/lib/app-version";
import type { JsonRpcMessage } from "../src/codex/protocol/json-rpc";
import type { ApiKeyPermissionProfile } from "./api-key-store";
import type { BrokerPublicUser } from "./runtime-broker-protocol";
import { RuntimeBrokerClient, type RuntimeBrokerConnection } from "./runtime-broker-client";
import { runtimeBrokerSocket } from "./web-auth";

export type JulesApiIdentity = {
  apiKey: string;
  authBinding: string;
  user: BrokerPublicUser;
  permissionProfile: ApiKeyPermissionProfile;
};

export type JulesRuntime = {
  user: BrokerPublicUser;
  permissionProfile: ApiKeyPermissionProfile;
  request: (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown>;
  notify: (method: string, params?: unknown) => void;
  close: () => void;
};

export type JulesRuntimeFactory = (request: Request, identity: JulesApiIdentity) => Promise<JulesRuntime>;

type MessageTransport = {
  send: (message: JsonRpcMessage) => void;
  onMessage: (listener: (message: JsonRpcMessage) => void) => () => void;
  onClose: (listener: (error?: Error) => void) => () => void;
  close: () => void;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class AppServerApiSession {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private closed = false;
  private readonly removeMessage: () => void;
  private readonly removeClose: () => void;

  constructor(private readonly transport: MessageTransport) {
    this.removeMessage = transport.onMessage((message) => this.handleMessage(message));
    this.removeClose = transport.onClose((error) => this.close(error));
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "codex_web_jules_api",
        title: "Codex Web Jules-compatible API",
        version: APP_VERSION,
      },
      capabilities: appServerInitializeCapabilities(),
    }, 20_000);
    this.notify("initialized");
  }

  request(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("app-server 连接已关闭"));
    const id = this.nextId++;
    const message: JsonRpcMessage = params === undefined
      ? { id, method }
      : { id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`app-server 请求超时: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.transport.send(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) throw new Error("app-server 连接已关闭");
    this.transport.send(params === undefined ? { method } : { method, params });
  }

  close(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.removeMessage();
    this.removeClose();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error ?? new Error("app-server 连接已关闭"));
    }
    this.pending.clear();
    this.transport.close();
  }

  private handleMessage(message: JsonRpcMessage): void {
    if ("method" in message) {
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }
    pending.resolve(message.result);
  }
}

export const createJulesRuntime: JulesRuntimeFactory = async (request, identity) => {
  const brokerSocket = runtimeBrokerSocket();
  if (brokerSocket) {
    const connection = await new RuntimeBrokerClient(brokerSocket).attachApiRuntime(
      identity.apiKey,
      identity.authBinding,
    );
    return await initializeRuntime(connection, connection.user, connection.permissionProfile ?? identity.permissionProfile);
  }

  const bridgeUrl = process.env.CODEX_WEB_BRIDGE_URL?.trim();
  if (!bridgeUrl) throw new Error("CODEX_WEB_BRIDGE_URL 未设置");
  const socket = await openWebSocket(resolveBridgeWebSocketUrl(bridgeUrl, request.url));
  const transport: MessageTransport = {
    send: (message) => {
      if (socket.readyState !== WebSocket.OPEN) throw new Error("Web bridge 连接已关闭");
      socket.send(JSON.stringify(message));
    },
    onMessage: (listener) => {
      const handleMessage = (data: WebSocket.RawData) => {
        try {
          listener(JSON.parse(data.toString("utf8")) as JsonRpcMessage);
        } catch {
          // Invalid bridge frames are diagnostics owned by the bridge process.
        }
      };
      socket.on("message", handleMessage);
      return () => socket.off("message", handleMessage);
    },
    onClose: (listener) => {
      const handleClose = () => listener(new Error("Web bridge 连接已关闭"));
      socket.once("close", handleClose);
      return () => socket.off("close", handleClose);
    },
    close: () => {
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN) socket.close();
    },
  };
  return initializeRuntime(transport, identity.user, identity.permissionProfile);
};

async function initializeRuntime(
  transport: MessageTransport,
  user: BrokerPublicUser,
  permissionProfile: ApiKeyPermissionProfile,
): Promise<JulesRuntime> {
  const session = new AppServerApiSession(transport);
  try {
    await session.initialize();
  } catch (error) {
    session.close();
    throw error;
  }
  return {
    user,
    permissionProfile,
    request: (method, params, timeoutMs) => session.request(method, params, timeoutMs),
    notify: (method, params) => session.notify(method, params),
    close: () => session.close(),
  };
}

export function resolveBridgeWebSocketUrl(configuredUrl: string, requestUrl: string): string {
  const resolved = new URL(configuredUrl, requestUrl);
  if (resolved.protocol === "http:") resolved.protocol = "ws:";
  else if (resolved.protocol === "https:") resolved.protocol = "wss:";
  if (resolved.protocol !== "ws:" && resolved.protocol !== "wss:") {
    throw new Error("CODEX_WEB_BRIDGE_URL 必须使用 ws:// 或 wss://");
  }
  return resolved.toString();
}

function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { perMessageDeflate: false });
    const timeout = setTimeout(() => {
      cleanup();
      socket.terminate();
      reject(new Error("Web bridge 连接超时"));
    }, 10_000);
    timeout.unref?.();
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("open", handleOpen);
      socket.off("error", handleError);
      socket.off("close", handleClose);
    };
    const handleOpen = () => {
      cleanup();
      resolve(socket);
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const handleClose = () => {
      cleanup();
      reject(new Error("Web bridge 连接已关闭"));
    };
    socket.once("open", handleOpen);
    socket.once("error", handleError);
    socket.once("close", handleClose);
  });
}

export function brokerConnectionTransport(connection: RuntimeBrokerConnection): MessageTransport {
  return {
    send: connection.send,
    onMessage: connection.onMessage,
    onClose: connection.onClose,
    close: connection.close,
  };
}
