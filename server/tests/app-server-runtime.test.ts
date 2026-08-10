import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import {
  buildControlSocketProcessOptions,
  resolveAppServerControlSocket,
  startAppServerRuntime,
} from "../app-server-runtime";
import { PersistentAppServer } from "../persistent-app-server";

describe("app-server runtime", () => {
  it("control socket 失效时启动同一用户的共享 listener，不回退 stdio", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-web-stale-control-socket-"));
    const controlDirectory = join(codexHome, "app-server-control");
    await mkdir(controlDirectory);
    const socketPath = join(controlDirectory, "app-server-control.sock");
    const staleServer = spawn(process.execPath, [
      "--input-type=module",
      "-e",
      "import { createServer } from 'node:net'; createServer().listen(process.argv[1]);",
      socketPath,
    ], { stdio: "ignore" });
    await waitFor(() => existsSync(socketPath));
    staleServer.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const marker = join(codexHome, "started.txt");
    const fixture = "import { appendFileSync } from 'node:fs'; appendFileSync(process.env.MARKER, process.argv.includes('--listen') ? 'listen\\n' : 'stdio\\n'); setInterval(() => {}, 1000);";
    const server = new PersistentAppServer({
      command: process.execPath,
      args: ["--input-type=module", "-e", fixture, "--", "--stdio"],
      codexHome,
      env: { MARKER: marker },
      inheritEnv: false,
    });
    try {
      await waitFor(() => existsSync(marker));
      const started = await readFile(marker, "utf8");
      expect(started).toBe("listen\n");
      expect(server.pid).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("将 stdio 参数转换为共享 listener 参数", () => {
    expect(buildControlSocketProcessOptions({
      command: "/usr/bin/setpriv",
      args: ["--reuid=1004", "--", "codex", "app-server", "--stdio"],
    })).toMatchObject({
      args: ["--reuid=1004", "--", "codex", "app-server", "--listen", "unix://"],
    });
    expect(buildControlSocketProcessOptions({ command: "codex", args: ["app-server"] })).toBeNull();
  });

  it("broker 显式优先共享 control socket，即使 socket 尚未创建", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-web-preferred-control-socket-"));
    const runtime = startAppServerRuntime({ codexHome, preferControlSocket: true });
    expect(runtime.kind).toBe("control-socket");
    runtime.stop();
  });

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
