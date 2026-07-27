import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import type { PassThrough } from "node:stream";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeAppServers = vi.hoisted(() => [] as unknown[]);

vi.mock("../codex-process", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");

  return {
    startCodexAppServer: () => {
      const child = Object.assign(new EventEmitter(), {
        pid: 43210 + fakeAppServers.length,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        kill: vi.fn(() => true),
      });
      const process = { child, diagnostics: [], stop: vi.fn() };
      fakeAppServers.push(process);
      return process;
    },
  };
});

import { createWebSocketBridge } from "../websocket-bridge";

describe("createWebSocketBridge 共享 Server", () => {
  let server: Server | null = null;

  beforeEach(() => {
    fakeAppServers.splice(0, fakeAppServers.length);
  });

  afterEach(async () => {
    if (!server?.listening) return;
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => error ? reject(error) : resolve());
    });
  });

  it("只接管指定 path，关闭 bridge 时保留共享 Server", async () => {
    server = createServer((_request, response) => {
      response.writeHead(404).end();
    });
    const bridge = createWebSocketBridge({
      server,
      path: "/codex-bridge",
      token: "secret",
      allowRemoteConnections: true,
    });
    server.on("upgrade", (request, socket) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (pathname === "/codex-bridge") return;
      socket.write("HTTP/1.1 426 Upgrade Required\r\n\r\n");
      socket.destroy();
    });
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("共享 Server 未返回端口");
    expect(bridge.appServerPid).toBe(43210);

    await expect(rawUpgrade(address.port, "/wrong?token=secret")).resolves.toContain("426 Upgrade Required");
    await expect(rawUpgrade(address.port, "/codex-bridge?token=wrong")).resolves.toContain("401 bridge token 无效");

    await bridge.close();
    expect(server.listening).toBe(true);
  });

  it("在两个客户端间广播 notification，并隔离 response 与路由 server request", async () => {
    const bridge = createWebSocketBridge({
      host: "127.0.0.1",
      token: "secret",
      allowRemoteConnections: true,
      allowedOrigins: ["http://127.0.0.1:3000"],
    });
    await waitUntilListening(bridge.server);
    const socketUrl = `${bridge.url()}?token=secret`;
    const clientA = await openWebSocket(socketUrl);
    const clientB = await openWebSocket(socketUrl);
    const messagesA: Array<Record<string, unknown>> = [];
    const messagesB: Array<Record<string, unknown>> = [];
    clientA.on("message", (data) => messagesA.push(JSON.parse(data.toString())));
    clientB.on("message", (data) => messagesB.push(JSON.parse(data.toString())));

    expect(fakeAppServers).toHaveLength(1);
    const appServer = fakeAppServers[0] as FakeAppServer;
    appServer.child.stdout.write(`${JSON.stringify({ method: "turn/started", params: { threadId: "thread-1" } })}\n`);
    await waitFor(() => messagesA.length === 1 && messagesB.length === 1);
    expect(messagesA[0]).toEqual(messagesB[0]);

    const writes: Array<Record<string, unknown>> = [];
    appServer.child.stdin.on("data", (data) => writes.push(JSON.parse(data.toString())));
    clientA.send(JSON.stringify({ id: 7, method: "thread/read", params: { threadId: "thread-a" } }));
    clientB.send(JSON.stringify({ id: 7, method: "thread/read", params: { threadId: "thread-b" } }));
    await waitFor(() => writes.length === 2);
    expect(writes[0]?.id).not.toBe(writes[1]?.id);

    appServer.child.stdout.write(`${JSON.stringify({ id: writes[1]?.id, result: { thread: "thread-b" } })}\n`);
    await waitFor(() => messagesB.length === 2);
    expect(messagesB[1]).toEqual({ id: 7, result: { thread: "thread-b" } });
    expect(messagesA).toHaveLength(1);

    clientA.send(JSON.stringify({ method: "bridge/sync/userMessage", params: { threadId: "thread-1" } }));
    await waitFor(() => messagesB.length === 3);
    expect(messagesB[2]).toMatchObject({ method: "bridge/sync/userMessage" });
    expect(messagesA).toHaveLength(1);

    appServer.child.stdout.write(`${JSON.stringify({
      id: 99,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1" },
    })}\n`);
    await waitFor(() => messagesA.length === 2 && messagesB.length === 4);
    const publicId = messagesB[3].id;
    expect(publicId).toMatch(/^bridge-server-request:/);

    clientB.send(JSON.stringify({ id: publicId, result: { decision: "accept" } }));
    await waitFor(() => writes.length === 3 && messagesA.length === 3 && messagesB.length === 5);
    expect(writes[2]).toEqual({ id: 99, result: { decision: "accept" } });
    expect(messagesA[2]).toEqual({ method: "serverRequest/resolved", params: { requestId: publicId } });

    clientA.send(JSON.stringify({ id: publicId, result: { decision: "decline" } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writes).toHaveLength(3);

    clientA.close();
    clientB.close();
    await waitFor(() => clientA.readyState === WebSocket.CLOSED && clientB.readyState === WebSocket.CLOSED);
    expect(appServer.stop).not.toHaveBeenCalled();

    await bridge.close();
    expect(appServer.stop).toHaveBeenCalledTimes(1);
  });

  it("缓存 initialize 响应，并向重连客户端重放未决 server request", async () => {
    const bridge = createWebSocketBridge({ host: "127.0.0.1", token: "secret", allowRemoteConnections: true });
    await waitUntilListening(bridge.server);
    const socketUrl = `${bridge.url()}?token=secret`;
    const appServer = fakeAppServers[0] as FakeAppServer;
    const writes: Array<Record<string, unknown>> = [];
    appServer.child.stdin.on("data", (data) => writes.push(JSON.parse(data.toString())));

    const first = await openWebSocket(socketUrl);
    const firstMessages: Array<Record<string, unknown>> = [];
    first.on("message", (data) => firstMessages.push(JSON.parse(data.toString())));
    first.send(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "test" } } }));
    await waitFor(() => writes.length === 1);
    appServer.child.stdout.write(`${JSON.stringify({ id: writes[0]?.id, result: { userAgent: "codex-test" } })}\n`);
    await waitFor(() => firstMessages.length === 1);
    first.close();
    await waitFor(() => first.readyState === WebSocket.CLOSED);

    appServer.child.stdout.write(`${JSON.stringify({
      id: 77,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1" },
    })}\n`);

    const secondMessages: Array<Record<string, unknown>> = [];
    const second = await openWebSocket(socketUrl, secondMessages);
    await waitFor(() => secondMessages.some((message) => message.method === "item/commandExecution/requestApproval"));
    second.send(JSON.stringify({ id: 9, method: "initialize", params: { clientInfo: { name: "test" } } }));
    await waitFor(() => secondMessages.some((message) => message.id === 9));
    expect(writes).toHaveLength(1);
    expect(secondMessages.find((message) => message.id === 9)).toEqual({
      id: 9,
      result: { userAgent: "codex-test" },
    });

    await bridge.close();
  });

  it("app-server fatal exit 后拉起新进程并要求客户端重新 initialize", async () => {
    const bridge = createWebSocketBridge({
      host: "127.0.0.1",
      token: "secret",
      allowRemoteConnections: true,
    });
    await waitUntilListening(bridge.server);
    const socketUrl = `${bridge.url()}?token=secret`;
    const first = await openWebSocket(socketUrl);
    const firstMessages: Array<Record<string, unknown>> = [];
    first.on("message", (data) => firstMessages.push(JSON.parse(data.toString())));
    const firstAppServer = fakeAppServers[0] as FakeAppServer;
    const firstWrites: Array<Record<string, unknown>> = [];
    firstAppServer.child.stdin.on("data", (data) => firstWrites.push(JSON.parse(data.toString())));

    first.send(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "test" } } }));
    await waitFor(() => firstWrites.length === 1);
    firstAppServer.child.stdout.write(
      `${JSON.stringify({ id: firstWrites[0]?.id, result: { userAgent: "codex-first" } })}\n`,
    );
    await waitFor(() => firstMessages.some((message) => message.id === 1));

    firstAppServer.child.emit("exit", 1, null);

    await waitFor(() => first.readyState === WebSocket.CLOSED);
    await waitFor(() => fakeAppServers.length === 2);
    expect(firstMessages).toContainEqual(expect.objectContaining({ method: "bridge/error" }));
    expect(bridge.appServerPid).toBe(43211);

    const secondAppServer = fakeAppServers[1] as FakeAppServer;
    const secondWrites: Array<Record<string, unknown>> = [];
    secondAppServer.child.stdin.on("data", (data) => secondWrites.push(JSON.parse(data.toString())));
    const secondMessages: Array<Record<string, unknown>> = [];
    const second = await openWebSocket(socketUrl, secondMessages);
    second.send(JSON.stringify({ id: 2, method: "initialize", params: { clientInfo: { name: "test" } } }));
    await waitFor(() => secondWrites.length === 1);
    expect(secondWrites[0]).toMatchObject({ method: "initialize" });
    secondAppServer.child.stdout.write(
      `${JSON.stringify({ id: secondWrites[0]?.id, result: { userAgent: "codex-second" } })}\n`,
    );
    await waitFor(() => secondMessages.some((message) => message.id === 2));
    expect(secondMessages.find((message) => message.id === 2)).toEqual({
      id: 2,
      result: { userAgent: "codex-second" },
    });

    await bridge.close();
  });

  it("bridge 主动关闭后不重新拉起 app-server", async () => {
    const bridge = createWebSocketBridge({
      host: "127.0.0.1",
      token: "secret",
      allowRemoteConnections: true,
    });
    await waitUntilListening(bridge.server);

    await bridge.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fakeAppServers).toHaveLength(1);
  });

  it("bridge 主动关闭会取消等待中的 app-server 重启", async () => {
    const bridge = createWebSocketBridge({
      host: "127.0.0.1",
      token: "secret",
      allowRemoteConnections: true,
    });
    await waitUntilListening(bridge.server);
    const firstAppServer = fakeAppServers[0] as FakeAppServer;

    firstAppServer.child.emit("exit", 1, null);
    await waitFor(() => fakeAppServers.length === 2);
    const secondAppServer = fakeAppServers[1] as FakeAppServer;
    secondAppServer.child.emit("exit", 1, null);

    await bridge.close();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(fakeAppServers).toHaveLength(2);
  });
});

type FakeAppServer = {
  child: {
    emit: (event: string, ...args: unknown[]) => boolean;
    stdin: PassThrough;
    stdout: PassThrough;
  };
  stop: ReturnType<typeof vi.fn>;
};

function waitUntilListening(server: Server): Promise<void> {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve) => server.once("listening", resolve));
}

function openWebSocket(url: string, messages?: Array<Record<string, unknown>>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin: "http://127.0.0.1:3000" });
    if (messages) {
      socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    }
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("等待 WebSocket 消息超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function rawUpgrade(port: number, requestPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let response = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write([
        `GET ${requestPath} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Origin: http://127.0.0.1:3000",
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("end", () => resolve(response));
    socket.on("close", () => resolve(response));
    socket.on("error", reject);
  });
}
