import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createWebSocketBridge } from "./websocket-bridge";

describe("createWebSocketBridge 共享 Server", () => {
  let server: Server | null = null;

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
});

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
