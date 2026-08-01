import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

import next from "next";

import {
  readProductionPort,
  resolveProductionServerPaths,
} from "../server/production-server-options";
import { createBrokerWebSocketBridge } from "../server/broker-websocket-bridge";
import { createWebSocketBridge } from "../server/websocket-bridge";
import { readWebAuthConfig, runtimeBrokerSocket } from "../server/web-auth";

const brokerSocket = runtimeBrokerSocket();
if (!brokerSocket && !process.env.CODEX_HOME) {
  console.error("start 必须显式设置 CODEX_HOME；可在当前 shell 或 .bashrc 中 export CODEX_HOME。");
  process.exit(1);
}
if (!brokerSocket) readWebAuthConfig(process.env);

const paths = resolveProductionServerPaths(
  import.meta.url,
  process.cwd(),
  process.env.CODEX_WEB_APP_ROOT,
);
process.env.CODEX_WEB_APP_ROOT = paths.applicationRoot;

const buildIdPath = paths.buildIdPath;
if (!existsSync(buildIdPath)) {
  console.log("未找到可用的 Next.js 生产构建，正在执行 npm run build...");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const build = spawnSync(npmCommand, ["run", "build"], {
    cwd: paths.applicationRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (build.error) {
    console.error("无法启动生产构建：", build.error.message);
    process.exit(1);
  }
  if (build.status !== 0 || !existsSync(buildIdPath)) {
    console.error("Next.js 生产构建失败，Codex Web 未启动。请先修复上方构建错误。");
    process.exit(build.status || 1);
  }
}

const publicHost = process.env.CODEX_WEB_PUBLIC_HOST ?? "192.168.3.12";
const nextHost = process.env.CODEX_WEB_NEXT_HOST ?? "0.0.0.0";
const requestedPort = readProductionPort(process.env.PORT);
const bridgePath = "/codex-bridge";

const app = next({
  dev: false,
  dir: paths.applicationRoot,
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

let legacyBridgeToken: string | null = null;
let legacyAppServerPid: number | undefined;
const bridge = brokerSocket
  ? createBrokerWebSocketBridge({
      server,
      path: bridgePath,
      brokerSocketPath: brokerSocket,
      allowRemoteConnections: true,
      allowSameOrigin: true,
    })
  : (() => {
      const legacyBridge = createWebSocketBridge({
        server,
        path: bridgePath,
        allowRemoteConnections: true,
        allowSameOrigin: true,
        cwd: paths.workingDirectory,
        codexHome: process.env.CODEX_HOME,
      });
      legacyBridgeToken = legacyBridge.token;
      legacyAppServerPid = legacyBridge.appServerPid;
      return legacyBridge;
    })();
process.env.CODEX_WEB_BRIDGE_URL = brokerSocket ? bridgePath : `${bridgePath}?token=${legacyBridgeToken}`;

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
console.log(`Codex Web bridge: ws://${publicHost}:${actualPort}${process.env.CODEX_WEB_BRIDGE_URL}`);
if (!brokerSocket) console.log(`Codex app-server PID: ${legacyAppServerPid ?? "未知"}`);
else console.log(`Codex Web runtime broker: ${brokerSocket}`);
console.log(`Codex Web 应用目录: ${paths.applicationRoot}`);
console.log(`Codex Web 工作目录: ${paths.workingDirectory}`);
console.log(`Codex Web 状态目录: ${process.env.CODEX_WEB_STATE ?? process.env.CODEX_HOME ?? "未单独设置"}`);

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
