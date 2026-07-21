import WebSocket from "ws";

import { startCodexAppServer, type CodexProcess, type CodexProcessOptions } from "./codex-process";
import { BridgeServerRequestRouter } from "./bridge-message-routing";
import { JsonRpcClient } from "./json-rpc-client";
import type {
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
} from "../src/codex/protocol/json-rpc";

type ClientRequestRoute = {
  socket: WebSocket;
  clientId: JsonRpcId;
};

type InitializeWaiter = ClientRequestRoute;

export class PersistentAppServer {
  private process: CodexProcess | null = null;
  private rpc: JsonRpcClient | null = null;
  private readonly sockets = new Set<WebSocket>();
  private readonly requestRoutes = new Map<string, ClientRequestRoute>();
  private serverRequestRouter = new BridgeServerRequestRouter<JsonRpcClient>();
  private readonly pendingServerRequests = new Map<string, JsonRpcRequest>();
  private readonly initializeWaiters: InitializeWaiter[] = [];
  private nextRequestId = 1;
  private initializeUpstreamId: string | null = null;
  private initializeResponse: Omit<JsonRpcResponse, "id"> | null = null;
  private initializedSent = false;
  private closed = false;
  private restartAttempt = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: CodexProcessOptions = {}) {
    this.startRuntime();
  }

  get pid(): number | undefined {
    return this.process?.child.pid;
  }

  attach(socket: WebSocket): void {
    this.sockets.add(socket);
    if (!this.rpc) {
      this.sendBridgeError(socket, "app-server 正在恢复");
      socket.close(1013, "app-server 正在恢复");
      return;
    }
    for (const request of this.pendingServerRequests.values()) {
      this.send(socket, request);
    }
  }

  detach(socket: WebSocket): void {
    this.sockets.delete(socket);
    for (const [upstreamId, route] of this.requestRoutes) {
      if (route.socket === socket) {
        this.requestRoutes.delete(upstreamId);
      }
    }
    for (let index = this.initializeWaiters.length - 1; index >= 0; index -= 1) {
      if (this.initializeWaiters[index]?.socket === socket) {
        this.initializeWaiters.splice(index, 1);
      }
    }
  }

  handleClientMessage(socket: WebSocket, message: JsonRpcMessage): void {
    const rpc = this.rpc;
    if (!rpc) {
      this.sendBridgeError(socket, "app-server 正在恢复");
      socket.close(1013, "app-server 正在恢复");
      return;
    }

    if ("method" in message) {
      if (message.id !== undefined) {
        this.handleClientRequest(socket, message, rpc);
        return;
      }
      if (message.method === "initialized") {
        if (!this.initializedSent) {
          this.initializedSent = true;
          rpc.sendRaw(message);
        }
        return;
      }
      rpc.sendRaw(message);
      return;
    }

    if (!this.serverRequestRouter.isPublicId(message.id)) {
      return;
    }
    const route = this.serverRequestRouter.take(message.id);
    if (!route) {
      return;
    }
    this.pendingServerRequests.delete(String(message.id));
    this.broadcast({ method: "serverRequest/resolved", params: { requestId: message.id } });
    route.owner.sendRaw({ ...message, id: route.originalId });
  }

  broadcast(message: JsonRpcMessage, excludedSocket?: WebSocket): void {
    for (const socket of this.sockets) {
      if (socket !== excludedSocket) {
        this.send(socket, message);
      }
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const rpc = this.rpc;
    const process = this.process;
    this.rpc = null;
    this.process = null;
    rpc?.close(new Error("Web bridge 已关闭"));
    process?.stop();
  }

  private startRuntime(): void {
    if (this.closed || this.rpc) {
      return;
    }

    const process = startCodexAppServer(this.options);
    const rpc = new JsonRpcClient({
      input: process.child.stdout,
      output: process.child.stdin,
      closeEmitter: process.child,
    });
    this.process = process;
    this.rpc = rpc;
    rpc.on("message", (message) => {
      if (this.rpc === rpc) this.handleAppServerMessage(message, rpc);
    });
    rpc.on("error", (error) => {
      if (this.rpc === rpc) this.broadcastBridgeError(error.message);
    });
    rpc.on("close", (error) => this.handleRuntimeClose(rpc, process, error));
  }

  private handleRuntimeClose(rpc: JsonRpcClient, process: CodexProcess, error?: Error): void {
    if (this.closed || this.rpc !== rpc) {
      return;
    }

    this.rpc = null;
    this.process = null;
    process.stop();
    this.resetProtocolState();

    const diagnostics = process.diagnostics.slice(-5);
    const detail = diagnostics.length > 0 ? `\n${diagnostics.join("\n")}` : "";
    this.broadcastBridgeError(`${error?.message ?? "app-server 已关闭"}${detail}`);
    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1011, "app-server 已退出");
      }
    }
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.closed || this.restartTimer) {
      return;
    }
    const delay = restartDelayMs(this.restartAttempt);
    this.restartAttempt += 1;
    if (delay === 0) {
      this.startRuntime();
      return;
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.startRuntime();
    }, delay);
  }

  private resetProtocolState(): void {
    this.requestRoutes.clear();
    this.serverRequestRouter = new BridgeServerRequestRouter<JsonRpcClient>();
    this.pendingServerRequests.clear();
    this.initializeWaiters.splice(0);
    this.initializeUpstreamId = null;
    this.initializeResponse = null;
    this.initializedSent = false;
  }

  private handleClientRequest(
    socket: WebSocket,
    request: JsonRpcRequest,
    rpc: JsonRpcClient,
  ): void {
    if (request.method === "initialize") {
      this.handleInitialize(socket, request, rpc);
      return;
    }

    const upstreamId = this.createUpstreamId();
    this.requestRoutes.set(upstreamId, { socket, clientId: request.id });
    rpc.sendRaw({ ...request, id: upstreamId });
  }

  private handleInitialize(socket: WebSocket, request: JsonRpcRequest, rpc: JsonRpcClient): void {
    if (this.initializeResponse) {
      this.send(socket, { id: request.id, ...this.initializeResponse });
      return;
    }

    this.initializeWaiters.push({ socket, clientId: request.id });
    if (this.initializeUpstreamId) {
      return;
    }

    this.initializeUpstreamId = this.createUpstreamId();
    rpc.sendRaw({ ...request, id: this.initializeUpstreamId });
  }

  private handleAppServerMessage(message: JsonRpcMessage, rpc: JsonRpcClient): void {
    if ("method" in message) {
      if (message.id === undefined) {
        this.broadcast(message);
        return;
      }
      const publicId = this.serverRequestRouter.register(rpc, message.id);
      const publicRequest = { ...message, id: publicId };
      this.pendingServerRequests.set(publicId, publicRequest);
      this.broadcast(publicRequest);
      return;
    }

    const upstreamId = String(message.id);
    if (upstreamId === this.initializeUpstreamId) {
      this.completeInitialize(message);
      return;
    }

    const route = this.requestRoutes.get(upstreamId);
    if (!route) {
      return;
    }
    this.requestRoutes.delete(upstreamId);
    this.send(route.socket, { ...message, id: route.clientId });
  }

  private completeInitialize(response: JsonRpcResponse): void {
    this.initializeUpstreamId = null;
    const responseBody = response.error
      ? { error: response.error }
      : { result: response.result };
    if (!response.error) {
      this.initializeResponse = responseBody;
      this.restartAttempt = 0;
    }
    const waiters = this.initializeWaiters.splice(0);
    for (const waiter of waiters) {
      this.send(waiter.socket, { id: waiter.clientId, ...responseBody });
    }
  }

  private createUpstreamId(): string {
    return `bridge-client-request:${this.nextRequestId++}`;
  }

  private broadcastBridgeError(message: string): void {
    this.broadcast({
      method: "bridge/error",
      params: { message, source: "codex-web-bridge" },
    });
  }

  private sendBridgeError(socket: WebSocket, message: string): void {
    this.send(socket, {
      method: "bridge/error",
      params: { message, source: "codex-web-bridge" },
    });
  }

  private send(socket: WebSocket, message: JsonRpcMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}

function restartDelayMs(attempt: number): number {
  if (attempt === 0) return 0;
  return Math.min(250 * 2 ** (attempt - 1), 5_000);
}
