import type { AppServerPeer } from "./app-server-peer";
import { buildControlSocketProcessOptions, startAppServerRuntime, type AppServerRuntime } from "./app-server-runtime";
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
  socket: AppServerPeer;
  clientId: JsonRpcId;
  process?: { action: "spawn" | "kill"; handle: string };
};

type InitializeWaiter = ClientRequestRoute;

export class PersistentAppServer {
  private runtime: AppServerRuntime | null = null;
  private rpc: JsonRpcClient | null = null;
  private readonly sockets = new Set<AppServerPeer>();
  private readonly requestRoutes = new Map<string, ClientRequestRoute>();
  private readonly processHandlesBySocket = new Map<AppServerPeer, Set<string>>();
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
  private controlProcess: CodexProcess | null = null;

  constructor(
    private readonly options: CodexProcessOptions = {},
    private readonly onNotification?: (message: JsonRpcMessage) => void,
  ) {
    this.startRuntime();
  }

  get pid(): number | undefined {
    return this.runtime?.pid;
  }

  attach(socket: AppServerPeer): void {
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

  detach(socket: AppServerPeer): void {
    this.sockets.delete(socket);
    this.killOwnedProcesses(socket);
    for (const [upstreamId, route] of this.requestRoutes) {
      if (route.socket === socket) {
        if (route.process?.action === "spawn") continue;
        this.requestRoutes.delete(upstreamId);
      }
    }
    for (let index = this.initializeWaiters.length - 1; index >= 0; index -= 1) {
      if (this.initializeWaiters[index]?.socket === socket) {
        this.initializeWaiters.splice(index, 1);
      }
    }
  }

  handleClientMessage(socket: AppServerPeer, message: JsonRpcMessage): void {
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

  broadcast(message: JsonRpcMessage, excludedSocket?: AppServerPeer): void {
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
    const runtime = this.runtime;
    this.rpc = null;
    this.runtime = null;
    rpc?.close(new Error("Web bridge 已关闭"));
    runtime?.stop();
    this.controlProcess?.stop();
    this.controlProcess = null;
  }

  private startRuntime(): void {
    if (this.closed || this.rpc) {
      return;
    }

    const runtime = startAppServerRuntime(this.options);
    const rpc = runtime.rpc;
    this.runtime = runtime;
    this.rpc = rpc;
    rpc.on("message", (message) => {
      if (this.rpc === rpc) this.handleAppServerMessage(message, rpc);
    });
    rpc.on("error", (error) => {
      if (this.rpc === rpc) this.broadcastBridgeError(error.message);
    });
    rpc.on("close", (error) => this.handleRuntimeClose(rpc, runtime, error));
    if (rpc.isClosed()) this.handleRuntimeClose(rpc, runtime);
  }

  private handleRuntimeClose(rpc: JsonRpcClient, runtime: AppServerRuntime, error?: Error): void {
    if (this.closed || this.rpc !== rpc) {
      return;
    }

    this.rpc = null;
    this.runtime = null;
    runtime.stop();
    if (runtime.kind === "control-socket") this.ensureControlSocketProcess();
    this.resetProtocolState();

    const diagnostics = runtime.diagnostics.slice(-5);
    const detail = diagnostics.length > 0 ? `\n${diagnostics.join("\n")}` : "";
    this.broadcastBridgeError(`${error?.message ?? "app-server 已关闭"}${detail}`);
    for (const socket of this.sockets) {
      if (socket.isOpen()) {
        socket.close(1011, "app-server 已退出");
      }
    }
    this.scheduleRestart();
  }

  private ensureControlSocketProcess(): void {
    if (this.controlProcess) return;
    const options = buildControlSocketProcessOptions(this.options);
    if (!options) return;
    const process = startCodexAppServer(options);
    this.controlProcess = process;
    process.child.once("exit", () => {
      if (this.controlProcess?.child === process.child) this.controlProcess = null;
    });
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
    this.processHandlesBySocket.clear();
    this.serverRequestRouter = new BridgeServerRequestRouter<JsonRpcClient>();
    this.pendingServerRequests.clear();
    this.initializeWaiters.splice(0);
    this.initializeUpstreamId = null;
    this.initializeResponse = null;
    this.initializedSent = false;
  }

  private handleClientRequest(
    socket: AppServerPeer,
    request: JsonRpcRequest,
    rpc: JsonRpcClient,
  ): void {
    if (request.method === "initialize") {
      this.handleInitialize(socket, request, rpc);
      return;
    }

    const process = processRequest(request);
    if (process?.action === "spawn") this.addProcessHandle(socket, process.handle);
    const upstreamId = this.createUpstreamId();
    this.requestRoutes.set(upstreamId, { socket, clientId: request.id, ...(process ? { process } : {}) });
    rpc.sendRaw({ ...request, id: upstreamId });
  }

  private handleInitialize(socket: AppServerPeer, request: JsonRpcRequest, rpc: JsonRpcClient): void {
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
        if (message.method === "process/exited") {
          const handle = processHandle(message.params);
          if (handle) this.removeProcessHandle(handle);
        }
        this.onNotification?.(message);
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
    if (route.process?.action === "spawn") {
      if (message.error) this.removeProcessHandle(route.process.handle, route.socket);
      else if (!this.sockets.has(route.socket)) this.sendProcessKill(route.process.handle, rpc);
    } else if (route.process?.action === "kill" && !message.error) {
      this.removeProcessHandle(route.process.handle, route.socket);
    }
    this.send(route.socket, { ...message, id: route.clientId });
  }

  private addProcessHandle(socket: AppServerPeer, handle: string): void {
    const handles = this.processHandlesBySocket.get(socket) ?? new Set<string>();
    handles.add(handle);
    this.processHandlesBySocket.set(socket, handles);
  }

  private removeProcessHandle(handle: string, socket?: AppServerPeer): void {
    const entries = socket
      ? [[socket, this.processHandlesBySocket.get(socket)] as const]
      : [...this.processHandlesBySocket.entries()];
    for (const [owner, handles] of entries) {
      if (!handles?.delete(handle)) continue;
      if (handles.size === 0) this.processHandlesBySocket.delete(owner);
    }
  }

  private killOwnedProcesses(socket: AppServerPeer): void {
    const handles = this.processHandlesBySocket.get(socket);
    if (!handles) return;
    this.processHandlesBySocket.delete(socket);
    const rpc = this.rpc;
    if (!rpc) return;
    for (const handle of handles) this.sendProcessKill(handle, rpc);
  }

  private sendProcessKill(handle: string, rpc: JsonRpcClient): void {
    rpc.sendRaw({
      id: this.createUpstreamId(),
      method: "process/kill",
      params: { processHandle: handle },
    });
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

  private sendBridgeError(socket: AppServerPeer, message: string): void {
    this.send(socket, {
      method: "bridge/error",
      params: { message, source: "codex-web-bridge" },
    });
  }

  private send(socket: AppServerPeer, message: JsonRpcMessage): void {
    if (socket.isOpen()) {
      socket.send(JSON.stringify(message));
    }
  }
}

function restartDelayMs(attempt: number): number {
  if (attempt === 0) return 0;
  return Math.min(250 * 2 ** (attempt - 1), 5_000);
}

function processRequest(request: JsonRpcRequest): ClientRequestRoute["process"] | undefined {
  if (request.method !== "process/spawn" && request.method !== "process/kill") return undefined;
  const handle = processHandle(request.params);
  if (!handle) return undefined;
  return { action: request.method === "process/spawn" ? "spawn" : "kill", handle };
}

function processHandle(params: unknown): string | null {
  if (!params || typeof params !== "object") return null;
  const handle = (params as { processHandle?: unknown }).processHandle;
  return typeof handle === "string" && handle.length > 0 ? handle : null;
}
