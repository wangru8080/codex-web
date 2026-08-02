import { spawn } from "node:child_process";
import { createServer } from "node:http";

import { createBrokerWebSocketBridge } from "../server/broker-websocket-bridge";
import { createThreadTurnsListFailureInterceptorFromEnv } from "../server/thread-turns-list-failure-interceptor";
import { createWebSocketBridge } from "../server/websocket-bridge";
import { readWebAuthConfig, runtimeBrokerSocket } from "../server/web-auth";

const defaultCodexHome = "/volume2/SSD/codex/Temp/codex-dev-home";
const codexHome = process.env.CODEX_HOME?.trim() || defaultCodexHome;
process.env.CODEX_HOME = codexHome;
const brokerSocket = runtimeBrokerSocket();
if (!brokerSocket) readWebAuthConfig(process.env);

const publicHost = process.env.CODEX_WEB_PUBLIC_HOST ?? "192.168.3.12";
const devOrigins = [3000, 3001].flatMap((port) => [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
  `http://${publicHost}:${port}`,
]);
let legacyBridgeToken: string | null = null;
let legacyAppServerPid: number | undefined;
const bridge = brokerSocket
  ? createBrokerWebSocketBridge({
      server: createServer((_request, response) => response.writeHead(404).end()),
      path: "/codex-bridge",
      brokerSocketPath: brokerSocket,
      allowedOrigins: devOrigins,
      allowRemoteConnections: true,
    })
  : (() => {
      const legacyBridge = createWebSocketBridge({
        host: "0.0.0.0",
        cwd: process.cwd(),
        codexHome,
        allowedOrigins: devOrigins,
        allowRemoteConnections: true,
        clientMessageInterceptor: createThreadTurnsListFailureInterceptorFromEnv(process.env),
      });
      legacyBridgeToken = legacyBridge.token;
      legacyAppServerPid = legacyBridge.appServerPid;
      return legacyBridge;
    })();
if (brokerSocket) bridge.server.listen(0, "0.0.0.0");
await waitForListening(bridge.server);

const address = bridge.server.address();
const bridgePort =
  typeof address === "object" && address !== null
    ? address.port
    : 0;
const bridgeUrl = brokerSocket
  ? `ws://${publicHost}:${bridgePort}/codex-bridge`
  : `ws://${publicHost}:${bridgePort}?token=${legacyBridgeToken}`;
process.env.CODEX_WEB_BRIDGE_URL = bridgeUrl;
console.log(`Codex Web bridge: ${bridgeUrl}`);
if (!brokerSocket) console.log(`Codex app-server PID: ${legacyAppServerPid ?? "未知"}`);
else console.log(`Codex Web runtime broker: ${brokerSocket}`);
console.log(`Codex Web 开发 CODEX_HOME: ${codexHome}`);

const next = spawn("next", ["dev"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_CODEX_BRIDGE_URL: bridgeUrl,
  },
});

next.on("exit", async (code, signal) => {
  await bridge.close();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

process.on("SIGINT", () => next.kill("SIGINT"));
process.on("SIGTERM", () => next.kill("SIGTERM"));

function waitForListening(server: import("node:http").Server): Promise<void> {
  if (server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve) => server.once("listening", resolve));
}
