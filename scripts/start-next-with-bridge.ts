import { createServer, type Server } from "node:http";

import next from "next";

import { readProductionPort } from "../server/production-server-options";
import { createWebSocketBridge } from "../server/websocket-bridge";

if (!process.env.CODEX_HOME) {
  console.error("start 必须显式设置 CODEX_HOME；可在当前 shell 或 .bashrc 中 export CODEX_HOME。");
  process.exit(1);
}

const publicHost = process.env.CODEX_WEB_PUBLIC_HOST ?? "192.168.3.12";
const nextHost = process.env.CODEX_WEB_NEXT_HOST ?? "0.0.0.0";
const requestedPort = readProductionPort(process.env.PORT);
const bridgePath = "/codex-bridge";

const app = next({
  dev: false,
  hostname: nextHost,
  port: requestedPort,
});
await app.prepare();
const requestHandler = app.getRequestHandler();
const nextUpgradeHandler = app.getUpgradeHandler();
const server = createServer((request, response) => {
  void requestHandler(request, response).catch((error) => {
    console.error("Next 请求处理失败：", error);
    if (!response.headersSent) response.writeHead(500);
    response.end("internal server error");
  });
});

const bridge = createWebSocketBridge({
  server,
  path: bridgePath,
  allowRemoteConnections: true,
  allowSameOrigin: true,
  codexHome: process.env.CODEX_HOME,
});
process.env.CODEX_WEB_BRIDGE_URL = `${bridgePath}?token=${bridge.token}`;

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname === bridgePath) return;
  void nextUpgradeHandler(request, socket, head).catch((error) => {
    console.error("Next WebSocket upgrade 处理失败：", error);
    socket.destroy();
  });
});

await listen(server, requestedPort, nextHost);

const address = server.address();
if (!address || typeof address === "string") throw new Error("生产 Server 未返回 TCP 端口");
const actualPort = address.port;
console.log(`Codex Web: http://${publicHost}:${actualPort}`);
console.log(`Codex Web bridge: ws://${publicHost}:${actualPort}${bridgePath}?token=${bridge.token}`);
console.log(`Codex Web CODEX_HOME: ${process.env.CODEX_HOME}`);

let closing = false;
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
}

async function shutdown(exitCode: number): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await bridge.close();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    await app.close();
    process.exit(exitCode);
  } catch (error) {
    console.error("Codex Web 关闭失败：", error);
    process.exit(1);
  }
}
