import type { AppServerPeer } from "./app-server-peer";
import { isBridgeSyncNotification } from "./bridge-message-routing";
import type { RuntimeBrokerUserConfig } from "./runtime-broker-config";
import {
  parseJsonRpcMessage,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from "../src/codex/protocol/json-rpc";
import {
  BROKER_PRESENCE_LIST_METHOD,
  brokerPresenceNotification,
  parseBrokerPresenceListParams,
  type BrokerOnlineUser,
  type BrokerPresenceListResponse,
} from "../src/codex-web/broker-presence";

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
    const wasOnline = entry.peers.size > 0;
    const runtimePeer = this.runtimePeer(user.id, peer);
    entry.peers.set(peer, runtimePeer);
    entry.server.attach(runtimePeer);
    if (!wasOnline) this.broadcastPresence();
    else if (entry.user.osUser === "root") this.sendPresence(runtimePeer);
    return { pid: entry.server.pid };
  }

  detach(userId: string, peer: AppServerPeer): void {
    const entry = this.runtimes.get(userId);
    const runtimePeer = entry?.peers.get(peer);
    if (!entry || !runtimePeer) return;
    entry.peers.delete(peer);
    entry.pendingTurnStarts.delete(peer);
    entry.server.detach(runtimePeer);
    if (entry.peers.size === 0) this.broadcastPresence();
    this.scheduleCloseWhenIdle(entry);
  }

  handleClientMessage(userId: string, peer: AppServerPeer, message: JsonRpcMessage): void {
    const entry = this.runtimes.get(userId);
    const runtimePeer = entry?.peers.get(peer);
    if (!entry || !runtimePeer) throw new Error("用户 runtime 未连接");
    if (isPresenceListRequest(message)) {
      this.handlePresenceListRequest(entry, peer, message);
      return;
    }
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

  onlineUserCount(): number {
    let count = 0;
    for (const entry of this.runtimes.values()) {
      if (entry.peers.size > 0) count += 1;
    }
    return count;
  }

  reload(options: RegistryOptions & {
    affectedUserIds: Set<string>;
    users: RuntimeBrokerUserConfig[];
  }): void {
    if (this.closed) throw new Error("runtime registry 已关闭");
    const previousOnlineUsers = this.onlineUserCount();
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
    if (this.onlineUserCount() !== previousOnlineUsers) this.broadcastPresence();
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

  private handlePresenceListRequest(
    entry: RuntimeEntry,
    peer: AppServerPeer,
    message: JsonRpcRequest,
  ): void {
    if (entry.user.osUser !== "root") {
      this.sendResponse(peer, {
        id: message.id,
        error: { code: -32003, message: "无权查看在线账号" },
      });
      return;
    }
    try {
      this.sendResponse(peer, {
        id: message.id,
        result: this.onlineUsersPage(message.params),
      });
    } catch (error) {
      this.sendResponse(peer, {
        id: message.id,
        error: {
          code: -32602,
          message: error instanceof Error ? error.message : "在线账号分页参数无效",
        },
      });
    }
  }

  private onlineUsersPage(params: unknown): BrokerPresenceListResponse {
    const { query, limit, cursor } = parseBrokerPresenceListParams(params);
    const users: BrokerOnlineUser[] = [];
    for (const entry of this.runtimes.values()) {
      if (entry.peers.size === 0) continue;
      const user = {
        id: entry.user.id,
        email: entry.user.email,
        osUser: entry.user.osUser,
        connections: entry.peers.size,
        activeTurns: this.turnCount(entry),
      };
      if (
        query
        && !user.id.toLowerCase().includes(query)
        && !user.email.toLowerCase().includes(query)
        && !user.osUser.toLowerCase().includes(query)
      ) continue;
      users.push(user);
    }
    users.sort(compareOnlineUsers);
    const cursorUser = cursor ? decodeOnlineUserCursor(cursor) : null;
    const start = cursorUser
      ? users.findIndex((user) => compareOnlineUsers(user, cursorUser) > 0)
      : 0;
    const pageStart = start < 0 ? users.length : start;
    const items = users.slice(pageStart, pageStart + limit);
    const hasMore = pageStart + items.length < users.length;
    return {
      total: users.length,
      items,
      nextCursor: hasMore && items.length > 0
        ? encodeOnlineUserCursor(items[items.length - 1]!)
        : null,
    };
  }

  private sendResponse(peer: AppServerPeer, response: JsonRpcMessage): void {
    if (peer.isOpen()) peer.send(JSON.stringify(response));
  }

  private broadcastPresence(): void {
    const notification = brokerPresenceNotification(this.onlineUserCount());
    for (const entry of this.runtimes.values()) {
      if (entry.user.osUser === "root" && entry.peers.size > 0) {
        entry.server.broadcast(notification);
      }
    }
  }

  private sendPresence(peer: AppServerPeer): void {
    if (peer.isOpen()) {
      peer.send(JSON.stringify(brokerPresenceNotification(this.onlineUserCount())));
    }
  }
}

export class RuntimeCapacityError extends Error {
  constructor(readonly limit: number) {
    super(`全局活跃 app-server 已达上限（${limit}）`);
  }
}

function isTurnStartRequest(
  message: JsonRpcMessage,
): message is JsonRpcRequest & { method: "turn/start" } {
  return "method" in message && message.method === "turn/start" && message.id !== undefined;
}

function isPresenceListRequest(
  message: JsonRpcMessage,
): message is JsonRpcRequest & { method: typeof BROKER_PRESENCE_LIST_METHOD } {
  return "method" in message
    && message.method === BROKER_PRESENCE_LIST_METHOD
    && message.id !== undefined;
}

function compareOnlineUsers(
  left: Pick<BrokerOnlineUser, "email" | "id">,
  right: Pick<BrokerOnlineUser, "email" | "id">,
): number {
  if (left.email < right.email) return -1;
  if (left.email > right.email) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function encodeOnlineUserCursor(user: Pick<BrokerOnlineUser, "email" | "id">): string {
  return Buffer.from(JSON.stringify([user.email, user.id]), "utf8").toString("base64url");
}

function decodeOnlineUserCursor(cursor: string): Pick<BrokerOnlineUser, "email" | "id"> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !Array.isArray(parsed)
      || parsed.length !== 2
      || typeof parsed[0] !== "string"
      || typeof parsed[1] !== "string"
    ) throw new Error();
    return { email: parsed[0], id: parsed[1] };
  } catch {
    throw new Error("cursor 无效");
  }
}

function readTurnId(params: unknown): string | null {
  if (typeof params !== "object" || params === null || !("turn" in params)) return null;
  const turn = (params as { turn?: unknown }).turn;
  if (typeof turn !== "object" || turn === null || !("id" in turn)) return null;
  const id = (turn as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
