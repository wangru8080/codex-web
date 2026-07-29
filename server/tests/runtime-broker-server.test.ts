import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppServerPeer } from "../app-server-peer";
import { parseRuntimeBrokerConfig } from "../runtime-broker-config";
import { RuntimeBrokerClient } from "../runtime-broker-client";
import { hashBrokerPassword } from "../runtime-broker-password";
import { createRuntimeBrokerServer } from "../runtime-broker-server";
import type { UserRuntimeServer } from "../user-runtime-registry";
import type { JsonRpcMessage } from "../../src/codex/protocol/json-rpc";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("runtime broker server", () => {
  it("登录、验证 Session，并在首次 attach 时创建 runtime", async () => {
    const passwordHash = await hashBrokerPassword("correct-password");
    const created: FakeRuntime[] = [];
    const { socketPath, config } = await fixture(passwordHash);
    const server = await createRuntimeBrokerServer({
      socketPath,
      config,
      createRuntime: () => {
        const runtime = fakeRuntime();
        created.push(runtime);
        return runtime;
      },
    });
    servers.push(server);
    const client = new RuntimeBrokerClient(socketPath);

    const login = await client.login("codex@example.com", "correct-password", "127.0.0.1");
    expect(login.user).toMatchObject({ id: "codex", osUser: "codex", home: "/home/codex" });
    expect(created).toHaveLength(0);
    await expect(client.verifySession(login.token)).resolves.toMatchObject({ id: "codex" });

    const connection = await client.attachRuntime(login.token);
    expect(created).toHaveLength(1);
    expect(connection.user.id).toBe("codex");
    connection.close();
  });

  it("错误密码和伪造 Session 不创建 runtime", async () => {
    const passwordHash = await hashBrokerPassword("correct-password");
    const created = vi.fn(() => fakeRuntime());
    const { socketPath, config } = await fixture(passwordHash);
    const server = await createRuntimeBrokerServer({ socketPath, config, createRuntime: created });
    servers.push(server);
    const client = new RuntimeBrokerClient(socketPath);

    await expect(client.login("codex@example.com", "wrong", "127.0.0.1")).rejects.toThrow("邮箱或密码错误");
    await expect(client.attachRuntime("forged.session")).rejects.toThrow("登录已失效");
    expect(created).not.toHaveBeenCalled();
  });

  it("伪造不同来源不能绕过账号登录限速", async () => {
    const passwordHash = await hashBrokerPassword("correct-password");
    const { socketPath, config } = await fixture(passwordHash);
    const server = await createRuntimeBrokerServer({
      socketPath,
      config,
      createRuntime: () => fakeRuntime(),
    });
    servers.push(server);
    const client = new RuntimeBrokerClient(socketPath);

    for (let index = 0; index < 5; index += 1) {
      await expect(client.login("codex@example.com", "wrong", `198.51.100.${index}`))
        .rejects.toThrow("邮箱或密码错误");
    }
    await expect(client.login("codex@example.com", "correct-password", "203.0.113.20"))
      .rejects.toThrow("登录尝试过多");
  });

  it("attach 后双向转发 JSON-RPC message", async () => {
    const passwordHash = await hashBrokerPassword("correct-password");
    const runtime: { current: FakeRuntime | null } = { current: null };
    const { socketPath, config } = await fixture(passwordHash);
    const server = await createRuntimeBrokerServer({
      socketPath,
      config,
      createRuntime: () => (runtime.current = fakeRuntime()),
    });
    servers.push(server);
    const client = new RuntimeBrokerClient(socketPath);
    const login = await client.login("codex@example.com", "correct-password", "127.0.0.1");
    const connection = await client.attachRuntime(login.token);
    const received: unknown[] = [];
    connection.onMessage((message) => received.push(message));

    connection.send({ id: 1, method: "thread/list", params: {} });
    await waitFor(() => runtime.current?.handleClientMessage.mock.calls.length === 1);
    expect(runtime.current?.handleClientMessage.mock.calls[0]?.[1]).toMatchObject({ id: 1, method: "thread/list" });

    const peer = runtime.current?.attach.mock.calls[0]?.[0] as AppServerPeer;
    peer.send(JSON.stringify({ id: 1, result: { data: [] } }));
    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual({ id: 1, result: { data: [] } });
    connection.close();
  });
});

type FakeRuntime = UserRuntimeServer & {
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  handleClientMessage: ReturnType<typeof vi.fn>;
  broadcast: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function fakeRuntime(): FakeRuntime {
  return {
    pid: 43100,
    attach: vi.fn<(peer: AppServerPeer) => void>(),
    detach: vi.fn<(peer: AppServerPeer) => void>(),
    handleClientMessage: vi.fn<(peer: AppServerPeer, message: JsonRpcMessage) => void>(),
    broadcast: vi.fn<(message: JsonRpcMessage, excludedPeer?: AppServerPeer) => void>(),
    close: vi.fn<() => void>(),
  };
}

async function fixture(passwordHash: string) {
  const directory = await mkdtemp(join(tmpdir(), "codex-web-broker-server-"));
  return {
    socketPath: join(directory, "broker.sock"),
    config: parseRuntimeBrokerConfig({
      version: 1,
      sessionSecret: "0123456789abcdef0123456789abcdef",
      codexCommand: "/usr/local/bin/codex",
      disconnectGraceMs: 0,
      users: [{
        id: "codex",
        email: "codex@example.com",
        passwordHash,
        osUser: "codex",
        home: "/home/codex",
        codexHome: "/home/codex/CodexApp",
        cwd: "/home/codex/workspace",
      }],
    }),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("等待 broker 消息超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
