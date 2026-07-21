import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";

import type { CodexProcessOptions } from "./codex-process";
import { isBridgeSyncNotification } from "./bridge-message-routing";
import { PersistentAppServer } from "./persistent-app-server";
import { validateBridgeRequest } from "./security";
import type { JsonRpcMessage, JsonRpcResponse } from "../src/codex/protocol/json-rpc";

export type ClientMessageInterceptor = (message: JsonRpcMessage) => JsonRpcResponse | null | undefined;

export type WebSocketBridgeOptions = CodexProcessOptions & {
  host?: string;
  port?: number;
  server?: Server;
  path?: string;
  token?: string;
  allowedOrigins?: string[];
  allowRemoteConnections?: boolean;
  allowSameOrigin?: boolean;
  clientMessageInterceptor?: ClientMessageInterceptor;
};

export type WebSocketBridge = {
  server: Server;
  token: string;
  appServerPid: number | undefined;
  url: () => string;
  close: () => Promise<void>;
};

export function createWebSocketBridge(options: WebSocketBridgeOptions = {}): WebSocketBridge {
  const token = options.token ?? randomBytes(24).toString("base64url");
  const ownsServer = options.server === undefined;
  const server = options.server ?? createServer((_request, response) => {
    response.writeHead(404);
    response.end("not found");
  });
  const bridgePath = options.path ?? "/";
  const sockets = new Set<WebSocket>();
  const wsServer = new WebSocketServer({ noServer: true });
  const broadcast = (message: JsonRpcMessage, excludedSocket?: WebSocket) => {
    const serialized = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket !== excludedSocket && socket.readyState === WebSocket.OPEN) {
        socket.send(serialized);
      }
    }
  };
  const appServer = new PersistentAppServer(options);

  const handleUpgrade = (request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== bridgePath) return;
    const security = validateBridgeRequest(request, {
      token,
      allowedOrigins: options.allowedOrigins,
      allowRemoteConnections: options.allowRemoteConnections,
      allowSameOrigin: options.allowSameOrigin,
    });

    if (!security.ok) {
      socket.write(`HTTP/1.1 ${security.statusCode} ${security.message}\r\n\r\n`);
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (webSocket) => {
      wsServer.emit("connection", webSocket, request);
    });
  };
  server.on("upgrade", handleUpgrade);

  wsServer.on("connection", (webSocket, request) => {
    sockets.add(webSocket);
    appServer.attach(webSocket);
    attachClient(webSocket, request, options, appServer, broadcast);
    webSocket.on("close", () => {
      sockets.delete(webSocket);
      appServer.detach(webSocket);
    });
  });

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  if (ownsServer) server.listen(port, host);

  return {
    server,
    token,
    get appServerPid() {
      return appServer.pid;
    },
    url: () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        return `ws://${host}:${port}${bridgePath === "/" ? "" : bridgePath}`;
      }
      return `ws://${address.address}:${address.port}${bridgePath === "/" ? "" : bridgePath}`;
    },
    close: () => new Promise((resolve, reject) => {
      const finish = () => {
        appServer.close();
        wsServer.removeAllListeners();
        if (!ownsServer || !server.listening) {
          resolve();
          return;
        }
        server.close((serverError) => {
          if (serverError) {
            reject(serverError);
            return;
          }
          resolve();
        });
      };
      server.off("upgrade", handleUpgrade);
      if (sockets.size === 0) {
        finish();
        return;
      }
      for (const socket of sockets) {
        socket.close();
      }
      wsServer.close((wsError) => {
        if (wsError) {
          reject(wsError);
          return;
        }
        finish();
      });
    }),
  };
}

function attachClient(
  webSocket: WebSocket,
  _request: IncomingMessage,
  options: WebSocketBridgeOptions,
  appServer: PersistentAppServer,
  broadcast: (message: JsonRpcMessage, excludedSocket?: WebSocket) => void,
): void {
  webSocket.on("message", (data) => {
    try {
      const text = data.toString("utf8");
      const message = JSON.parse(text) as JsonRpcMessage;
      if (isBridgeSyncNotification(message)) {
        broadcast(message, webSocket);
        return;
      }
      const intercepted = options.clientMessageInterceptor?.(message);
      if (intercepted) {
        webSocket.send(JSON.stringify(intercepted));
        return;
      }
      appServer.handleClientMessage(webSocket, message);
    } catch (error) {
      sendBridgeError(webSocket, error instanceof Error ? error.message : String(error));
    }
  });
}

function sendBridgeError(webSocket: WebSocket, message: string): void {
  if (webSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  webSocket.send(
    JSON.stringify({
      method: "bridge/error",
      params: { message, source: "codex-web-bridge" },
    }),
  );
}
