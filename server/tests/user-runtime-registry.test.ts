import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppServerPeer } from "../app-server-peer";
import type { RuntimeBrokerUserConfig } from "../runtime-broker-config";
import { UserRuntimeRegistry, type UserRuntimeServer } from "../user-runtime-registry";
import type { JsonRpcMessage } from "../../src/codex/protocol/json-rpc";

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
    expect(created[0]?.broadcast).toHaveBeenCalledWith(expect.any(Object), first);
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
