import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";

import { RuntimeBrokerClient, type RuntimeBrokerConnection } from "./runtime-broker-client";
import { validateBrowserBridgeRequest } from "./security";
import { readSessionCookie } from "./web-auth";
import type { JsonRpcMessage } from "../src/codex/protocol/json-rpc";

type BrokerWebSocketBridgeOptions = {
  server: Server;
  path: string;
  brokerSocketPath: string;
  allowRemoteConnections?: boolean;
  allowSameOrigin?: boolean;
  allowedOrigins?: string[];
};

export type BrokerWebSocketBridge = {
  server: Server;
  close: () => Promise<void>;
};

export function createBrokerWebSocketBridge(options: BrokerWebSocketBridgeOptions): BrokerWebSocketBridge {
  const wsServer = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  const connections = new Map<WebSocket, RuntimeBrokerConnection>();

  const handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== options.path) return;
    const security = validateBrowserBridgeRequest(request, options);
    if (!security.ok) {
      rejectUpgrade(socket, security.statusCode, security.message);
      return;
    }
    let token: string | undefined;
    try {
      token = readSessionCookie(request.headers.cookie ?? null);
    } catch {
      rejectUpgrade(socket, 401, "登录已失效");
      return;
    }
    if (!token) {
      rejectUpgrade(socket, 401, "登录已失效");
      return;
    }
    void new RuntimeBrokerClient(options.brokerSocketPath).attachRuntime(token).then(
      (connection) => {
        if (socket.destroyed) {
          connection.close();
          return;
        }
        wsServer.handleUpgrade(request, socket, head, (webSocket) => {
          connections.set(webSocket, connection);
          wsServer.emit("connection", webSocket, request);
        });
      },
      () => rejectUpgrade(socket, 401, "登录已失效"),
    );
  };
  options.server.on("upgrade", handleUpgrade);

  wsServer.on("connection", (webSocket) => {
    const connection = connections.get(webSocket)!;
    sockets.add(webSocket);
    const removeMessage = connection.onMessage((message) => {
      if (webSocket.readyState === WebSocket.OPEN) webSocket.send(JSON.stringify(message));
    });
    const removeClose = connection.onClose(() => webSocket.close(1011, "runtime broker 已关闭"));
    webSocket.on("message", (data) => {
      try {
        connection.send(JSON.parse(data.toString("utf8")) as JsonRpcMessage);
      } catch (error) {
        sendBridgeError(webSocket, error instanceof Error ? error.message : String(error));
      }
    });
    webSocket.once("close", () => {
      sockets.delete(webSocket);
      connections.delete(webSocket);
      removeMessage();
      removeClose();
      connection.close();
    });
  });

  return {
    server: options.server,
    close: async () => {
      options.server.off("upgrade", handleUpgrade);
      for (const socket of sockets) socket.close();
      for (const connection of connections.values()) connection.close();
      if (sockets.size === 0) {
        wsServer.close();
        return;
      }
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  if (socket.destroyed) return;
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function sendBridgeError(webSocket: WebSocket, message: string): void {
  if (webSocket.readyState !== WebSocket.OPEN) return;
  webSocket.send(JSON.stringify({
    method: "bridge/error",
    params: { message, source: "codex-web-broker-bridge" },
  }));
}
