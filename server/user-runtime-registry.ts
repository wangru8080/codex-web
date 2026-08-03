import type { AppServerPeer } from "./app-server-peer";
import { isBridgeSyncNotification } from "./bridge-message-routing";
import type { RuntimeBrokerUserConfig } from "./runtime-broker-config";
import type { JsonRpcMessage } from "../src/codex/protocol/json-rpc";

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
  createRuntime: RuntimeFactory;
};

type RuntimeEntry = {
  user: RuntimeBrokerUserConfig;
  server: UserRuntimeServer;
  peers: Set<AppServerPeer>;
  activeTurns: Set<string>;
  closeTimer: ReturnType<typeof setTimeout> | null;
};

export class UserRuntimeRegistry {
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private closed = false;

  private disconnectGraceMs: number;
  private createRuntime: RuntimeFactory;

  constructor(options: RegistryOptions) {
    this.disconnectGraceMs = options.disconnectGraceMs;
    this.createRuntime = options.createRuntime;
  }

  attach(user: RuntimeBrokerUserConfig, peer: AppServerPeer): { pid: number | undefined } {
    if (this.closed) throw new Error("runtime registry 已关闭");
    if (!user.enabled) throw new Error("用户已禁用");
    let entry = this.runtimes.get(user.id);
    if (!entry) {
      const onNotification = (message: JsonRpcMessage) => this.handleNotification(user.id, message);
      entry = {
        user,
        server: this.createRuntime(user, onNotification),
        peers: new Set(),
        activeTurns: new Set(),
        closeTimer: null,
      };
      this.runtimes.set(user.id, entry);
    }
    if (entry.closeTimer) {
      clearTimeout(entry.closeTimer);
      entry.closeTimer = null;
    }
    entry.peers.add(peer);
    entry.server.attach(peer);
    return { pid: entry.server.pid };
  }

  detach(userId: string, peer: AppServerPeer): void {
    const entry = this.runtimes.get(userId);
    if (!entry || !entry.peers.delete(peer)) return;
    entry.server.detach(peer);
    this.scheduleCloseWhenIdle(entry);
  }

  handleClientMessage(userId: string, peer: AppServerPeer, message: JsonRpcMessage): void {
    const entry = this.runtimes.get(userId);
    if (!entry?.peers.has(peer)) throw new Error("用户 runtime 未连接");
    if (isBridgeSyncNotification(message)) {
      entry.server.broadcast(message, peer);
      return;
    }
    entry.server.handleClientMessage(peer, message);
  }

  runtimePid(userId: string): number | undefined {
    return this.runtimes.get(userId)?.server.pid;
  }

  runtimeCount(): number {
    return this.runtimes.size;
  }

  reload(options: RegistryOptions & { affectedUserIds: Set<string> }): void {
    if (this.closed) throw new Error("runtime registry 已关闭");
    this.disconnectGraceMs = options.disconnectGraceMs;
    this.createRuntime = options.createRuntime;
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
    if (entry.peers.size > 0 || entry.activeTurns.size > 0 || entry.closeTimer || this.closed) return;
    entry.closeTimer = setTimeout(() => {
      entry.closeTimer = null;
      if (entry.peers.size > 0 || entry.activeTurns.size > 0 || this.closed) return;
      entry.server.close();
      this.runtimes.delete(entry.user.id);
    }, this.disconnectGraceMs);
  }

  private closeEntry(entry: RuntimeEntry, reason: string): void {
    if (entry.closeTimer) clearTimeout(entry.closeTimer);
    entry.closeTimer = null;
    entry.server.close();
    for (const peer of entry.peers) peer.close(1012, reason);
    entry.peers.clear();
    entry.activeTurns.clear();
  }
}

function readTurnId(params: unknown): string | null {
  if (typeof params !== "object" || params === null || !("turn" in params)) return null;
  const turn = (params as { turn?: unknown }).turn;
  if (typeof turn !== "object" || turn === null || !("id" in turn)) return null;
  const id = (turn as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
