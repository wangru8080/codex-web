import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppServerPeer } from "../app-server-peer";
import type { RuntimeBrokerUserConfig } from "../runtime-broker-config";
import { UserRuntimeRegistry, type UserRuntimeServer } from "../user-runtime-registry";
import type { JsonRpcMessage } from "../../src/codex/protocol/json-rpc";
import { BROKER_PRESENCE_LIST_METHOD } from "../../src/codex-web/broker-presence";

const USER: RuntimeBrokerUserConfig = {
  id: "codex",
  email: "codex@example.com",
  passwordHash: "scrypt$v1$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  osUser: "codex",
  home: "/home/codex",
  codexHome: "/home/codex/CodexApp",
  cwd: "/home/codex/workspace",
  role: "user",
  enabled: true,
  allowRoot: false,
};

afterEach(() => vi.useRealTimers());

describe("UserRuntimeRegistry", () => {
  it("同用户共享 runtime，不同用户使用不同 runtime", () => {
    const created: FakeRuntime[] = [];
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: (_user, onNotification) => {
        const runtime = fakeRuntime(onNotification);
        created.push(runtime);
        return runtime;
      },
    });
    const first = peer();
    const second = peer();
    const other = peer();

    registry.attach(USER, first);
    registry.attach(USER, second);
    registry.attach({ ...USER, id: "alice", email: "alice@example.com", osUser: "alice" }, other);

    expect(created).toHaveLength(2);
    expect(created[0]?.attach).toHaveBeenCalledTimes(2);
    expect(created[1]?.attach).toHaveBeenCalledTimes(1);
  });

  it("在线人数按账号而不是 peer 计数", () => {
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: (_user, onNotification) => fakeRuntime(onNotification),
    });
    const first = peer();
    const second = peer();
    const other = peer();

    registry.attach(USER, first);
    registry.attach(USER, second);
    expect(registry.onlineUserCount()).toBe(1);

    registry.attach({ ...USER, id: "alice", email: "alice@example.com" }, other);
    expect(registry.onlineUserCount()).toBe(2);

    registry.detach(USER.id, first);
    expect(registry.onlineUserCount()).toBe(2);
    registry.detach(USER.id, second);
    expect(registry.onlineUserCount()).toBe(1);
  });

  it("presence 只广播给 root，并向 root 的新 peer 发送快照", () => {
    const runtimes = new Map<string, FakeRuntime>();
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: (user, onNotification) => {
        const runtime = fakeRuntime(onNotification);
        runtimes.set(user.id, runtime);
        return runtime;
      },
    });
    const normalPeer = peer();
    const rootPeer = peer();
    const rootSecondPeer = peer();
    registry.attach(USER, normalPeer);
    registry.attach({
      ...USER,
      id: "root",
      email: "root@example.com",
      osUser: "root",
      role: "admin",
      allowRoot: true,
    }, rootPeer);

    expect(runtimes.get(USER.id)?.broadcast).not.toHaveBeenCalled();
    expect(runtimes.get("root")?.broadcast).toHaveBeenLastCalledWith({
      method: "bridge/presence/updated",
      params: { onlineUsers: 2 },
    });

    registry.attach({
      ...USER,
      id: "root",
      email: "root@example.com",
      osUser: "root",
      role: "admin",
      allowRoot: true,
    }, rootSecondPeer);
    expect(rootSecondPeer.send).toHaveBeenCalledWith(expect.stringContaining('"onlineUsers":2'));
    expect(registry.onlineUserCount()).toBe(2);

    const alicePeer = peer();
    registry.attach({ ...USER, id: "alice", email: "alice@example.com" }, alicePeer);
    expect(runtimes.get("root")?.broadcast).toHaveBeenLastCalledWith({
      method: "bridge/presence/updated",
      params: { onlineUsers: 3 },
    });
    expect(normalPeer.send).not.toHaveBeenCalled();

    registry.detach("alice", alicePeer);
    expect(runtimes.get("root")?.broadcast).toHaveBeenLastCalledWith({
      method: "bridge/presence/updated",
      params: { onlineUsers: 2 },
    });
  });

  it("root 按 cursor 分页、搜索在线账号，少量结果在一页结束", () => {
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: (_user, onNotification) => fakeRuntime(onNotification),
    });
    const rootPeer = peer();
    const rootSecondPeer = peer();
    const alicePeer = peer();
    const bobPeer = peer();
    const rootUser = {
      ...USER,
      id: "root",
      email: "root@example.com",
      osUser: "root",
      role: "admin" as const,
      allowRoot: true,
    };
    registry.attach(rootUser, rootPeer);
    registry.attach(rootUser, rootSecondPeer);
    registry.attach({ ...USER, id: "alice", email: "alice@example.com" }, alicePeer);
    registry.attach({ ...USER, id: "bob", email: "bob@example.com" }, bobPeer);
    registry.handleClientMessage("alice", alicePeer, {
      id: "turn-1",
      method: "turn/start",
      params: {},
    });

    registry.handleClientMessage("root", rootPeer, {
      id: "page-1",
      method: BROKER_PRESENCE_LIST_METHOD,
      params: { limit: 2 },
    });
    const firstPage = sentResult(rootPeer);
    expect(firstPage).toMatchObject({
      total: 3,
      items: [
        { id: "alice", email: "alice@example.com", connections: 1, activeTurns: 1 },
        { id: "bob", email: "bob@example.com", connections: 1, activeTurns: 0 },
      ],
    });
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    registry.handleClientMessage("root", rootPeer, {
      id: "page-2",
      method: BROKER_PRESENCE_LIST_METHOD,
      params: { limit: 2, cursor: firstPage.nextCursor },
    });
    expect(sentResult(rootPeer)).toEqual({
      total: 3,
      items: [{
        id: "root",
        email: "root@example.com",
        osUser: "root",
        connections: 2,
        activeTurns: 0,
      }],
      nextCursor: null,
    });

    registry.handleClientMessage("root", rootPeer, {
      id: "search",
      method: BROKER_PRESENCE_LIST_METHOD,
      params: { query: "ROOT", limit: 50 },
    });
    expect(sentResult(rootPeer)).toEqual({
      total: 1,
      items: [{
        id: "root",
        email: "root@example.com",
        osUser: "root",
        connections: 2,
        activeTurns: 0,
      }],
      nextCursor: null,
    });

    registry.handleClientMessage("root", rootPeer, {
      id: "invalid-cursor",
      method: BROKER_PRESENCE_LIST_METHOD,
      params: { cursor: "invalid" },
    });
    expect(sentMessage(rootPeer)).toEqual({
      id: "invalid-cursor",
      error: { code: -32602, message: "cursor 无效" },
    });
  });

  it("普通账号不能查询在线账号列表", () => {
    const runtime = fakeRuntime(() => undefined);
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: () => runtime,
    });
    const client = peer();
    registry.attach(USER, client);

    registry.handleClientMessage(USER.id, client, {
      id: 7,
      method: BROKER_PRESENCE_LIST_METHOD,
      params: { limit: 50 },
    });

    expect(sentMessage(client)).toEqual({
      id: 7,
      error: { code: -32003, message: "无权查看在线账号" },
    });
    expect(runtime.handleClientMessage).not.toHaveBeenCalled();
  });

  it("跨用户消息不广播，同用户同步消息只广播给同用户 peer", () => {
    const created: FakeRuntime[] = [];
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: (_user, onNotification) => {
        const runtime = fakeRuntime(onNotification);
        created.push(runtime);
        return runtime;
      },
    });
    const first = peer();
    const second = peer();
    const other = peer();
    registry.attach(USER, first);
    registry.attach(USER, second);
    registry.attach({ ...USER, id: "alice", email: "alice@example.com", osUser: "alice" }, other);

    registry.handleClientMessage(USER.id, first, {
      method: "bridge/sync/userMessage",
      params: { threadId: "thread-1", message: { id: "message-1" } },
    });

    expect(created[0]?.broadcast).toHaveBeenCalledTimes(1);
    expect(created[0]?.broadcast).toHaveBeenCalledWith(expect.any(Object), expect.any(Object));
    expect(created[1]?.broadcast).not.toHaveBeenCalled();
  });

  it("最后 peer 离开后宽限关闭，重连会复用并取消关闭", () => {
    vi.useFakeTimers();
    const runtime = fakeRuntime(() => undefined);
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: () => runtime,
    });
    const first = peer();
    registry.attach(USER, first);
    registry.detach(USER.id, first);
    vi.advanceTimersByTime(50);
    const second = peer();
    registry.attach(USER, second);
    vi.advanceTimersByTime(100);
    expect(runtime.close).not.toHaveBeenCalled();

    registry.detach(USER.id, second);
    vi.advanceTimersByTime(100);
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("没有 peer 但 Turn 运行时等待完成后再关闭", () => {
    vi.useFakeTimers();
    let notify: (message: JsonRpcMessage) => void = () => undefined;
    const runtime = fakeRuntime((message) => notify(message));
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: (_user, onNotification) => {
        notify = onNotification;
        return runtime;
      },
    });
    const client = peer();
    registry.attach(USER, client);
    notify({ method: "turn/started", params: { turn: { id: "turn-1" } } });
    registry.detach(USER.id, client);
    vi.advanceTimersByTime(1_000);
    expect(runtime.close).not.toHaveBeenCalled();

    notify({ method: "turn/completed", params: { turn: { id: "turn-1" } } });
    vi.advanceTimersByTime(100);
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it("重载时保留未变化用户，仅关闭受影响用户并更新 factory", () => {
    const firstRuntime = fakeRuntime(() => undefined);
    const replacementRuntime = fakeRuntime(() => undefined);
    const otherRuntime = fakeRuntime(() => undefined);
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: (user) => user.id === USER.id ? firstRuntime : otherRuntime,
    });
    const unchangedPeer = peer();
    const changedPeer = peer();
    registry.attach(USER, unchangedPeer);
    registry.attach({ ...USER, id: "alice", email: "alice@example.com" }, changedPeer);

    registry.reload({
      disconnectGraceMs: 250,
      createRuntime: () => replacementRuntime,
      affectedUserIds: new Set(["alice"]),
      users: [USER, { ...USER, id: "alice", email: "alice@example.com" }],
    });

    expect(firstRuntime.close).not.toHaveBeenCalled();
    expect(unchangedPeer.close).not.toHaveBeenCalled();
    expect(otherRuntime.close).toHaveBeenCalledTimes(1);
    expect(changedPeer.close).toHaveBeenCalledTimes(1);
    const replacementPeer = peer();
    registry.attach({ ...USER, id: "alice", email: "alice@example.com" }, replacementPeer);
    expect(replacementRuntime.attach).toHaveBeenCalledWith(expect.any(Object));
  });

  it("全局上限只阻止新 runtime，已有账号仍可重连", () => {
    const created: FakeRuntime[] = [];
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      maxActiveAppServers: 1,
      createRuntime: (_user, onNotification) => {
        const runtime = fakeRuntime(onNotification);
        created.push(runtime);
        return runtime;
      },
    });
    registry.attach(USER, peer());

    expect(() => registry.attach(USER, peer())).not.toThrow();
    expect(() => registry.attach(
      { ...USER, id: "alice", email: "alice@example.com" },
      peer(),
    )).toThrow("全局活跃 app-server 已达上限（1）");
    expect(created).toHaveLength(1);
  });

  it("未配置全局上限时不限制 runtime 数量", () => {
    const created = vi.fn(() => fakeRuntime(() => undefined));
    const registry = new UserRuntimeRegistry({ disconnectGraceMs: 100, createRuntime: created });

    registry.attach(USER, peer());
    registry.attach({ ...USER, id: "alice", email: "alice@example.com" }, peer());

    expect(created).toHaveBeenCalledTimes(2);
  });

  it("热加载降低全局上限不关闭已有 runtime，只阻止新建", () => {
    const created = vi.fn(() => fakeRuntime(() => undefined));
    const registry = new UserRuntimeRegistry({ disconnectGraceMs: 100, createRuntime: created });
    const first = peer();
    registry.attach(USER, first);

    registry.reload({
      disconnectGraceMs: 100,
      maxActiveAppServers: 1,
      createRuntime: created,
      affectedUserIds: new Set(),
      users: [USER, { ...USER, id: "alice", email: "alice@example.com" }],
    });

    expect(created.mock.results[0]?.value.close).not.toHaveBeenCalled();
    expect(() => registry.attach(USER, peer())).not.toThrow();
    expect(() => registry.attach(
      { ...USER, id: "alice", email: "alice@example.com" },
      peer(),
    )).toThrow("全局活跃 app-server 已达上限（1）");
  });

  it("单账号并发上限覆盖多个 peer，并在 Turn 完成后释放名额", () => {
    let notify: (message: JsonRpcMessage) => void = () => undefined;
    const runtime = fakeRuntime(() => undefined);
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: (_user, onNotification) => {
        notify = onNotification;
        return runtime;
      },
    });
    const user = { ...USER, maxConcurrentTurns: 1 };
    const first = peer();
    const second = peer();
    registry.attach(user, first);
    registry.attach(user, second);

    registry.handleClientMessage(user.id, first, { id: 1, method: "turn/start", params: {} });
    registry.handleClientMessage(user.id, second, { id: 2, method: "turn/start", params: {} });

    expect(runtime.handleClientMessage).toHaveBeenCalledTimes(1);
    expect(second.send).toHaveBeenCalledWith(expect.stringContaining("账号并发 Turn 已达上限"));

    const runtimePeer = runtime.attach.mock.calls[0]?.[0];
    runtimePeer?.send(JSON.stringify({ id: 1, result: { turn: { id: "turn-1" } } }));
    notify({ method: "turn/completed", params: { turn: { id: "turn-1" } } });
    registry.handleClientMessage(user.id, second, { id: 3, method: "turn/start", params: {} });
    expect(runtime.handleClientMessage).toHaveBeenCalledTimes(2);
  });

  it("turn/start 失败后释放预占名额", () => {
    const runtime = fakeRuntime(() => undefined);
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: () => runtime,
    });
    const user = { ...USER, maxConcurrentTurns: 1 };
    const client = peer();
    registry.attach(user, client);

    registry.handleClientMessage(user.id, client, { id: 1, method: "turn/start", params: {} });
    const runtimePeer = runtime.attach.mock.calls[0]?.[0];
    runtimePeer?.send(JSON.stringify({ id: 1, error: { code: -32602, message: "请求无效" } }));
    registry.handleClientMessage(user.id, client, { id: 2, method: "turn/start", params: {} });

    expect(runtime.handleClientMessage).toHaveBeenCalledTimes(2);
  });

  it("未配置账号上限时允许多个并发 turn/start", () => {
    const runtime = fakeRuntime(() => undefined);
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: () => runtime,
    });
    const client = peer();
    registry.attach(USER, client);

    registry.handleClientMessage(USER.id, client, { id: 1, method: "turn/start", params: {} });
    registry.handleClientMessage(USER.id, client, { id: 2, method: "turn/start", params: {} });

    expect(runtime.handleClientMessage).toHaveBeenCalledTimes(2);
  });

  it("不同账号分别计算 Turn 并发名额", () => {
    const runtimes = new Map<string, FakeRuntime>();
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: (user) => {
        const runtime = fakeRuntime(() => undefined);
        runtimes.set(user.id, runtime);
        return runtime;
      },
    });
    const firstUser = { ...USER, maxConcurrentTurns: 1 };
    const secondUser = {
      ...USER,
      id: "alice",
      email: "alice@example.com",
      maxConcurrentTurns: 1,
    };
    const first = peer();
    const second = peer();
    registry.attach(firstUser, first);
    registry.attach(secondUser, second);

    registry.handleClientMessage(firstUser.id, first, { id: 1, method: "turn/start", params: {} });
    registry.handleClientMessage(secondUser.id, second, { id: 1, method: "turn/start", params: {} });

    expect(runtimes.get(firstUser.id)?.handleClientMessage).toHaveBeenCalledTimes(1);
    expect(runtimes.get(secondUser.id)?.handleClientMessage).toHaveBeenCalledTimes(1);
  });

  it("热加载降低账号上限不终止已有 Turn，只阻止新请求", () => {
    const runtime = fakeRuntime(() => undefined);
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      createRuntime: () => runtime,
    });
    const originalUser = { ...USER, maxConcurrentTurns: 2 };
    const client = peer();
    registry.attach(originalUser, client);
    registry.handleClientMessage(USER.id, client, { id: 1, method: "turn/start", params: {} });
    registry.handleClientMessage(USER.id, client, { id: 2, method: "turn/start", params: {} });

    registry.reload({
      disconnectGraceMs: 100,
      createRuntime: () => runtime,
      affectedUserIds: new Set(),
      users: [{ ...USER, maxConcurrentTurns: 1 }],
    });
    registry.handleClientMessage(USER.id, client, { id: 3, method: "turn/start", params: {} });

    expect(runtime.close).not.toHaveBeenCalled();
    expect(runtime.handleClientMessage).toHaveBeenCalledTimes(2);
    expect(client.send).toHaveBeenCalledWith(expect.stringContaining("账号并发 Turn 已达上限（1）"));
  });

  it("热加载账号限制不关闭 runtime，并立即应用提高和移除限制", () => {
    const runtime = fakeRuntime(() => undefined);
    const registry = new UserRuntimeRegistry({
      disconnectGraceMs: 100,
      maxActiveAppServers: 1,
      createRuntime: () => runtime,
    });
    const limitedUser = { ...USER, maxConcurrentTurns: 1 };
    const first = peer();
    const second = peer();
    registry.attach(limitedUser, first);
    registry.attach(limitedUser, second);
    registry.handleClientMessage(USER.id, first, { id: 1, method: "turn/start", params: {} });

    const raisedUser = { ...USER, maxConcurrentTurns: 2 };
    registry.reload({
      disconnectGraceMs: 100,
      maxActiveAppServers: 2,
      createRuntime: () => runtime,
      affectedUserIds: new Set(),
      users: [raisedUser],
    });
    registry.handleClientMessage(USER.id, second, { id: 2, method: "turn/start", params: {} });

    registry.reload({
      disconnectGraceMs: 100,
      createRuntime: () => runtime,
      affectedUserIds: new Set(),
      users: [USER],
    });
    registry.handleClientMessage(USER.id, second, { id: 3, method: "turn/start", params: {} });

    expect(runtime.close).not.toHaveBeenCalled();
    expect(runtime.handleClientMessage).toHaveBeenCalledTimes(3);
  });
});

type FakeRuntime = UserRuntimeServer & {
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  handleClientMessage: ReturnType<typeof vi.fn>;
  broadcast: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function fakeRuntime(_onNotification: (message: JsonRpcMessage) => void): FakeRuntime {
  return {
    pid: 123,
    attach: vi.fn<(peer: AppServerPeer) => void>(),
    detach: vi.fn<(peer: AppServerPeer) => void>(),
    handleClientMessage: vi.fn<(peer: AppServerPeer, message: JsonRpcMessage) => void>(),
    broadcast: vi.fn<(message: JsonRpcMessage, excludedPeer?: AppServerPeer) => void>(),
    close: vi.fn<() => void>(),
  };
}

function peer(): AppServerPeer {
  return {
    isOpen: () => true,
    send: vi.fn(),
    close: vi.fn(),
  };
}

function sentMessage(client: AppServerPeer): Record<string, unknown> {
  const send = client.send as ReturnType<typeof vi.fn>;
  const serialized = send.mock.calls.at(-1)?.[0];
  if (typeof serialized !== "string") throw new Error("peer 未发送 JSON-RPC 消息");
  return JSON.parse(serialized) as Record<string, unknown>;
}

function sentResult(client: AppServerPeer): {
  total: number;
  items: Array<Record<string, unknown>>;
  nextCursor: string | null;
} {
  return sentMessage(client).result as {
    total: number;
    items: Array<Record<string, unknown>>;
    nextCursor: string | null;
  };
}
