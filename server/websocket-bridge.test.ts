import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import type { PassThrough } from "node:stream";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeAppServers = vi.hoisted(() => [] as unknown[]);

vi.mock("./codex-process", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");

  return {
    startCodexAppServer: () => {
      const child = Object.assign(new EventEmitter(), {
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

import { createWebSocketBridge } from "./websocket-bridge";

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

    const appServerA = fakeAppServers[0] as FakeAppServer;
    const appServerB = fakeAppServers[1] as FakeAppServer;
    appServerA.child.stdout.write(`${JSON.stringify({ method: "turn/started", params: { threadId: "thread-1" } })}\n`);
    await waitFor(() => messagesA.length === 1 && messagesB.length === 1);
    expect(messagesA[0]).toEqual(messagesB[0]);

    appServerA.child.stdout.write(`${JSON.stringify({ id: 7, result: { ok: true } })}\n`);
    await waitFor(() => messagesA.length === 2);
    expect(messagesA[1]).toEqual({ id: 7, result: { ok: true } });
    expect(messagesB).toHaveLength(1);

    clientA.send(JSON.stringify({ method: "bridge/sync/userMessage", params: { threadId: "thread-1" } }));
    await waitFor(() => messagesB.length === 2);
    expect(messagesB[1]).toMatchObject({ method: "bridge/sync/userMessage" });
    expect(messagesA).toHaveLength(2);

    const writesA: Array<Record<string, unknown>> = [];
    const writesB: Array<Record<string, unknown>> = [];
    appServerA.child.stdin.on("data", (data) => writesA.push(JSON.parse(data.toString())));
    appServerB.child.stdin.on("data", (data) => writesB.push(JSON.parse(data.toString())));
    appServerA.child.stdout.write(`${JSON.stringify({
      id: 99,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1" },
    })}\n`);
    await waitFor(() => messagesA.length === 3 && messagesB.length === 3);
    const publicId = messagesB[2].id;
    expect(publicId).toMatch(/^bridge-server-request:/);

    clientB.send(JSON.stringify({ id: publicId, result: { decision: "accept" } }));
    await waitFor(() => writesA.length === 1 && messagesA.length === 4 && messagesB.length === 4);
    expect(writesA[0]).toEqual({ id: 99, result: { decision: "accept" } });
    expect(writesB).toHaveLength(0);
    expect(messagesA[3]).toEqual({ method: "serverRequest/resolved", params: { requestId: publicId } });

    clientA.send(JSON.stringify({ id: publicId, result: { decision: "decline" } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writesA).toHaveLength(1);
    expect(writesB).toHaveLength(0);

    await bridge.close();
  });
});

type FakeAppServer = {
  child: {
    stdin: PassThrough;
    stdout: PassThrough;
  };
};

function waitUntilListening(server: Server): Promise<void> {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve) => server.once("listening", resolve));
}

function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin: "http://127.0.0.1:3000" });
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
