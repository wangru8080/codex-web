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
  private readonly process: CodexProcess;
  private readonly rpc: JsonRpcClient;
  private readonly sockets = new Set<WebSocket>();
  private readonly requestRoutes = new Map<string, ClientRequestRoute>();
  private readonly serverRequestRouter = new BridgeServerRequestRouter<JsonRpcClient>();
  private readonly pendingServerRequests = new Map<string, JsonRpcRequest>();
  private readonly initializeWaiters: InitializeWaiter[] = [];
  private nextRequestId = 1;
  private initializeUpstreamId: string | null = null;
  private initializeResponse: Omit<JsonRpcResponse, "id"> | null = null;
  private initializedSent = false;
  private closed = false;

  constructor(options: CodexProcessOptions = {}) {
    this.process = startCodexAppServer(options);
    this.rpc = new JsonRpcClient({
      input: this.process.child.stdout,
      output: this.process.child.stdin,
      closeEmitter: this.process.child,
    });
    this.rpc.on("message", (message) => this.handleAppServerMessage(message));
    this.rpc.on("error", (error) => this.broadcastBridgeError(error.message));
    this.rpc.on("close", (error) => {
      this.broadcastBridgeError(error?.message ?? "app-server 已关闭");
    });
  }

  get pid(): number | undefined {
    return this.process.child.pid;
  }

  attach(socket: WebSocket): void {
    this.sockets.add(socket);
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
    if ("method" in message) {
      if (message.id !== undefined) {
        this.handleClientRequest(socket, message);
        return;
      }
      if (message.method === "initialized") {
        if (!this.initializedSent) {
          this.initializedSent = true;
          this.rpc.sendRaw(message);
        }
        return;
      }
      this.rpc.sendRaw(message);
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
    this.rpc.close(new Error("Web bridge 已关闭"));
    this.process.stop();
  }

  private handleClientRequest(socket: WebSocket, request: JsonRpcRequest): void {
    if (request.method === "initialize") {
      this.handleInitialize(socket, request);
      return;
    }

    const upstreamId = this.createUpstreamId();
    this.requestRoutes.set(upstreamId, { socket, clientId: request.id });
    this.rpc.sendRaw({ ...request, id: upstreamId });
  }

  private handleInitialize(socket: WebSocket, request: JsonRpcRequest): void {
    if (this.initializeResponse) {
      this.send(socket, { id: request.id, ...this.initializeResponse });
      return;
    }

    this.initializeWaiters.push({ socket, clientId: request.id });
    if (this.initializeUpstreamId) {
      return;
    }

    this.initializeUpstreamId = this.createUpstreamId();
    this.rpc.sendRaw({ ...request, id: this.initializeUpstreamId });
  }

  private handleAppServerMessage(message: JsonRpcMessage): void {
    if ("method" in message) {
      if (message.id === undefined) {
        this.broadcast(message);
        return;
      }
      const publicId = this.serverRequestRouter.register(this.rpc, message.id);
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

  private send(socket: WebSocket, message: JsonRpcMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}
