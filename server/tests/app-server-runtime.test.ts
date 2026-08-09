import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import {
  resolveAppServerControlSocket,
  startAppServerRuntime,
} from "../app-server-runtime";

describe("app-server runtime", () => {
  it("仅在当前 CODEX_HOME 的 control socket 可访问时选择共享运行时", () => {
    const expected = "/chosen/app-server-control/app-server-control.sock";
    expect(resolveAppServerControlSocket(
      { codexHome: "/chosen" },
      "linux",
      (path) => path === expected,
    )).toBe(expected);
    expect(resolveAppServerControlSocket(
      { codexHome: "/chosen" },
      "linux",
      () => false,
    )).toBeNull();
    expect(resolveAppServerControlSocket(
      { codexHome: "/chosen" },
      "win32",
      () => true,
    )).toBeNull();
  });

  it("通过 Unix WebSocket 发送和接收 JSON-RPC，关闭时不关闭服务端", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-web-control-socket-"));
    const controlDirectory = join(codexHome, "app-server-control");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(controlDirectory));
    const socketPath = join(controlDirectory, "app-server-control.sock");
    const server = createServer();
    const websocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    server.on("upgrade", (request, socket, head) => {
      websocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        websocketServer.emit("connection", webSocket, request);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    const received: Array<Record<string, unknown>> = [];
    websocketServer.on("connection", (socket) => {
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        received.push(message);
        socket.send(JSON.stringify({ id: message.id, result: { ok: true } }));
      });
    });

    const runtime = startAppServerRuntime({ codexHome });
    expect(runtime.kind).toBe("control-socket");
    expect(runtime.pid).toBeUndefined();
    await expect(runtime.rpc.request("thread/read", { threadId: "thread-1" })).resolves.toEqual({ ok: true });
    expect(received).toEqual([{ id: 1, method: "thread/read", params: { threadId: "thread-1" } }]);

    runtime.stop();
    await waitFor(() => websocketServer.clients.size === 0);
    expect(server.listening).toBe(true);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    websocketServer.close();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("等待条件超时");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
