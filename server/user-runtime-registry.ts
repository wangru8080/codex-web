import type { AppServerPeer } from "./app-server-peer";
import { isBridgeSyncNotification } from "./bridge-message-routing";
import type { RuntimeBrokerUserConfig } from "./runtime-broker-config";
import {
  parseJsonRpcMessage,
  type JsonRpcId,
  type JsonRpcMessage,
} from "../src/codex/protocol/json-rpc";

export type UserRuntimeServer = {
  readonly pid: number | undefined;
  attach: (peer: AppServerPeer) => void;
  detach: (peer: AppServerPeer) => void;
  handleClientMessage: (peer: AppServerPeer, message: JsonRpcMessage) => void;
  broadcast: (message: JsonRpcMessage, excludedPeer?: AppServerPeer) => void;
  close: () => void;
};

type RuntimeFactory = (
  user: RuntimeBrokerUserConfig,
  onNotification: (message: JsonRpcMessage) => void,
) => UserRuntimeServer;

type RegistryOptions = {
  disconnectGraceMs: number;
  maxActiveAppServers?: number;
  createRuntime: RuntimeFactory;
};

type RuntimeEntry = {
  user: RuntimeBrokerUserConfig;
  server: UserRuntimeServer;
  peers: Map<AppServerPeer, AppServerPeer>;
  activeTurns: Set<string>;
  pendingTurnStarts: Map<AppServerPeer, Set<JsonRpcId>>;
  closeTimer: ReturnType<typeof setTimeout> | null;
};

export class UserRuntimeRegistry {
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private closed = false;

  private disconnectGraceMs: number;
  private maxActiveAppServers: number | undefined;
  private createRuntime: RuntimeFactory;

  constructor(options: RegistryOptions) {
    this.disconnectGraceMs = options.disconnectGraceMs;
    this.maxActiveAppServers = options.maxActiveAppServers;
    this.createRuntime = options.createRuntime;
  }

  attach(user: RuntimeBrokerUserConfig, peer: AppServerPeer): { pid: number | undefined } {
    if (this.closed) throw new Error("runtime registry 已关闭");
    if (!user.enabled) throw new Error("用户已禁用");
    let entry = this.runtimes.get(user.id);
    if (!entry) {
      if (
        this.maxActiveAppServers !== undefined
        && this.runtimes.size >= this.maxActiveAppServers
      ) {
        throw new RuntimeCapacityError(this.maxActiveAppServers);
      }
      const onNotification = (message: JsonRpcMessage) => this.handleNotification(user.id, message);
      entry = {
        user,
        server: this.createRuntime(user, onNotification),
        peers: new Map(),
        activeTurns: new Set(),
        pendingTurnStarts: new Map(),
        closeTimer: null,
      };
      this.runtimes.set(user.id, entry);
    }
    if (entry.closeTimer) {
      clearTimeout(entry.closeTimer);
      entry.closeTimer = null;
    }
    const runtimePeer = this.runtimePeer(user.id, peer);
    entry.peers.set(peer, runtimePeer);
    entry.server.attach(runtimePeer);
    return { pid: entry.server.pid };
  }

  detach(userId: string, peer: AppServerPeer): void {
    const entry = this.runtimes.get(userId);
    const runtimePeer = entry?.peers.get(peer);
    if (!entry || !runtimePeer) return;
    entry.peers.delete(peer);
    entry.pendingTurnStarts.delete(peer);
    entry.server.detach(runtimePeer);
    this.scheduleCloseWhenIdle(entry);
  }

  handleClientMessage(userId: string, peer: AppServerPeer, message: JsonRpcMessage): void {
    const entry = this.runtimes.get(userId);
    const runtimePeer = entry?.peers.get(peer);
    if (!entry || !runtimePeer) throw new Error("用户 runtime 未连接");
    if (isBridgeSyncNotification(message)) {
      entry.server.broadcast(message, runtimePeer);
      return;
    }
    if (isTurnStartRequest(message)) {
      const limit = entry.user.maxConcurrentTurns;
      if (limit !== undefined && this.turnCount(entry) >= limit) {
        if (peer.isOpen()) {
          peer.send(JSON.stringify({
            id: message.id,
            error: {
              code: -32001,
              message: `账号并发 Turn 已达上限（${limit}）`,
              data: { kind: "max_concurrent_turns", limit },
            },
          }));
        }
        return;
      }
      const pending = entry.pendingTurnStarts.get(peer) ?? new Set<JsonRpcId>();
      pending.add(message.id);
      entry.pendingTurnStarts.set(peer, pending);
    }
    entry.server.handleClientMessage(runtimePeer, message);
  }

  runtimePid(userId: string): number | undefined {
    return this.runtimes.get(userId)?.server.pid;
  }

  runtimeCount(): number {
    return this.runtimes.size;
  }

  reload(options: RegistryOptions & {
    affectedUserIds: Set<string>;
    users: RuntimeBrokerUserConfig[];
  }): void {
    if (this.closed) throw new Error("runtime registry 已关闭");
    this.disconnectGraceMs = options.disconnectGraceMs;
    this.maxActiveAppServers = options.maxActiveAppServers;
    this.createRuntime = options.createRuntime;
    const users = new Map(options.users.map((user) => [user.id, user]));
    for (const [userId, entry] of this.runtimes) {
      const user = users.get(userId);
      if (user && !options.affectedUserIds.has(userId)) entry.user = user;
    }
    for (const userId of options.affectedUserIds) {
      const entry = this.runtimes.get(userId);
      if (!entry) continue;
      this.closeEntry(entry, "用户配置已更新");
      this.runtimes.delete(userId);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.runtimes.values()) {
      this.closeEntry(entry, "runtime broker 已关闭");
    }
    this.runtimes.clear();
  }

  private handleNotification(userId: string, message: JsonRpcMessage): void {
    const entry = this.runtimes.get(userId);
    if (!entry || !("method" in message) || message.id !== undefined) return;
    const turnId = readTurnId(message.params);
    if (message.method === "turn/started" && turnId) {
      entry.activeTurns.add(turnId);
      return;
    }
    if (message.method === "turn/completed" && turnId) {
      entry.activeTurns.delete(turnId);
      this.scheduleCloseWhenIdle(entry);
    }
  }

  private scheduleCloseWhenIdle(entry: RuntimeEntry): void {
    if (entry.peers.size > 0 || this.turnCount(entry) > 0 || entry.closeTimer || this.closed) return;
    entry.closeTimer = setTimeout(() => {
      entry.closeTimer = null;
      if (entry.peers.size > 0 || this.turnCount(entry) > 0 || this.closed) return;
      entry.server.close();
      this.runtimes.delete(entry.user.id);
    }, this.disconnectGraceMs);
  }

  private closeEntry(entry: RuntimeEntry, reason: string): void {
    if (entry.closeTimer) clearTimeout(entry.closeTimer);
    entry.closeTimer = null;
    entry.server.close();
    for (const peer of entry.peers.keys()) peer.close(1012, reason);
    entry.peers.clear();
    entry.activeTurns.clear();
    entry.pendingTurnStarts.clear();
  }

  private runtimePeer(userId: string, peer: AppServerPeer): AppServerPeer {
    return {
      isOpen: () => peer.isOpen(),
      send: (serialized) => {
        this.handleRuntimeResponse(userId, peer, serialized);
        peer.send(serialized);
      },
      close: (code, reason) => peer.close(code, reason),
    };
  }

  private handleRuntimeResponse(userId: string, peer: AppServerPeer, serialized: string): void {
    const entry = this.runtimes.get(userId);
    const pending = entry?.pendingTurnStarts.get(peer);
    if (!entry || !pending || pending.size === 0) return;
    let message: JsonRpcMessage;
    try {
      message = parseJsonRpcMessage(serialized);
    } catch {
      return;
    }
    if ("method" in message || !pending.delete(message.id)) return;
    if (pending.size === 0) entry.pendingTurnStarts.delete(peer);
    const turnId = readTurnId(message.result);
    if (!message.error && turnId) entry.activeTurns.add(turnId);
    this.scheduleCloseWhenIdle(entry);
  }

  private turnCount(entry: RuntimeEntry): number {
    let pending = 0;
    for (const requests of entry.pendingTurnStarts.values()) pending += requests.size;
    return entry.activeTurns.size + pending;
  }
}

export class RuntimeCapacityError extends Error {
  constructor(readonly limit: number) {
    super(`全局活跃 app-server 已达上限（${limit}）`);
  }
}

function isTurnStartRequest(
  message: JsonRpcMessage,
): message is Extract<JsonRpcMessage, { method: string }> & { id: JsonRpcId } {
  return "method" in message && message.method === "turn/start" && message.id !== undefined;
}

function readTurnId(params: unknown): string | null {
  if (typeof params !== "object" || params === null || !("turn" in params)) return null;
  const turn = (params as { turn?: unknown }).turn;
  if (typeof turn !== "object" || turn === null || !("id" in turn)) return null;
  const id = (turn as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
