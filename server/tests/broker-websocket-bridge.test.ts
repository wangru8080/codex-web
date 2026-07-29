import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppServerPeer } from "../app-server-peer";
import { createBrokerWebSocketBridge, type BrokerWebSocketBridge } from "../broker-websocket-bridge";
import { RuntimeBrokerClient } from "../runtime-broker-client";
import { parseRuntimeBrokerConfig } from "../runtime-broker-config";
import { hashBrokerPassword } from "../runtime-broker-password";
import { createRuntimeBrokerServer, type RuntimeBrokerServer } from "../runtime-broker-server";
import type { UserRuntimeServer } from "../user-runtime-registry";
import { WEB_AUTH_COOKIE } from "../web-auth";
import type { JsonRpcMessage } from "../../src/codex/protocol/json-rpc";

const resources: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of resources.splice(0).reverse()) await close();
});

describe("broker WebSocket bridge", () => {
  it("按 Session 隔离用户并复用同一用户 runtime", async () => {
    const passwordHash = await hashBrokerPassword("correct-password");
    const directory = await mkdtemp(join(tmpdir(), "codex-web-broker-bridge-"));
    const config = parseRuntimeBrokerConfig({
      version: 1,
      sessionSecret: "0123456789abcdef0123456789abcdef",
      codexCommand: "/usr/local/bin/codex",
      disconnectGraceMs: 0,
      users: [
        userConfig("alice", passwordHash),
        userConfig("bob", passwordHash),
      ],
    });
    const runtimes = new Map<string, FakeRuntime[]>();
    const broker = await createRuntimeBrokerServer({
      socketPath: join(directory, "broker.sock"),
      config,
      createRuntime: (user) => {
        const runtime = fakeRuntime();
        runtimes.set(user.id, [...(runtimes.get(user.id) ?? []), runtime]);
        return runtime;
      },
    });
    trackBroker(broker);

    const server = createServer((_request, response) => response.writeHead(404).end());
    const bridge = createBrokerWebSocketBridge({
      server,
      path: "/codex-bridge",
      brokerSocketPath: broker.socketPath,
      allowRemoteConnections: true,
      allowSameOrigin: true,
    });
    trackBridge(bridge);
    await listen(server);
    trackServer(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试 Server 未返回端口");
    const url = `ws://127.0.0.1:${address.port}/codex-bridge`;
    const client = new RuntimeBrokerClient(broker.socketPath);
    const alice = await client.login("alice@example.com", "correct-password");
    const bob = await client.login("bob@example.com", "correct-password");

    await expect(openWebSocket(url)).rejects.toThrow();
    const aliceA = await openWebSocket(url, alice.token);
    const aliceB = await openWebSocket(url, alice.token);
    const bobA = await openWebSocket(url, bob.token);
    resources.push(async () => {
      aliceA.close();
      aliceB.close();
      bobA.close();
    });
    expect(runtimes.get("alice")).toHaveLength(1);
    expect(runtimes.get("bob")).toHaveLength(1);

    aliceA.send(JSON.stringify({ id: 1, method: "thread/list", params: {} }));
    bobA.send(JSON.stringify({ id: 2, method: "model/list", params: {} }));
    await waitFor(() => (
      runtimes.get("alice")?.[0]?.handleClientMessage.mock.calls.length === 1
      && runtimes.get("bob")?.[0]?.handleClientMessage.mock.calls.length === 1
    ));
    expect(runtimes.get("alice")?.[0]?.handleClientMessage.mock.calls[0]?.[1]).toMatchObject({ id: 1 });
    expect(runtimes.get("bob")?.[0]?.handleClientMessage.mock.calls[0]?.[1]).toMatchObject({ id: 2 });
  });
});

function userConfig(id: string, passwordHash: string) {
  return {
    id,
    email: `${id}@example.com`,
    passwordHash,
    osUser: id,
    home: `/home/${id}`,
    codexHome: `/home/${id}/CodexApp`,
    cwd: `/home/${id}/workspace`,
  };
}

type FakeRuntime = UserRuntimeServer & {
  handleClientMessage: ReturnType<typeof vi.fn>;
};

function fakeRuntime(): FakeRuntime {
  return {
    pid: 43001,
    attach: vi.fn<(peer: AppServerPeer) => void>(),
    detach: vi.fn<(peer: AppServerPeer) => void>(),
    handleClientMessage: vi.fn<(peer: AppServerPeer, message: JsonRpcMessage) => void>(),
    broadcast: vi.fn<(message: JsonRpcMessage, excludedPeer?: AppServerPeer) => void>(),
    close: vi.fn<() => void>(),
  };
}

function openWebSocket(url: string, token?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const socket = new WebSocket(url, {
      origin: `http://${parsed.host}`,
      ...(token ? { headers: { Cookie: `${WEB_AUTH_COOKIE}=${encodeURIComponent(token)}` } } : {}),
    });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("等待 broker bridge 消息超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function trackBroker(server: RuntimeBrokerServer): void {
  resources.push(() => server.close());
}

function trackBridge(bridge: BrokerWebSocketBridge): void {
  resources.push(() => bridge.close());
}

function trackServer(server: Server): void {
  resources.push(() => new Promise<void>((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  }));
}
