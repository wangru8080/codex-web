import { spawn } from "node:child_process";

import { createThreadTurnsListFailureInterceptorFromEnv } from "../server/thread-turns-list-failure-interceptor";
import { createWebSocketBridge } from "../server/websocket-bridge";

const requiredCodexHome = "/volume2/SSD/codex/Temp/codex-dev-home";

if (process.env.CODEX_HOME !== requiredCodexHome) {
  console.error(
    `dev 必须使用隔离 CODEX_HOME：${requiredCodexHome}，当前为 ${process.env.CODEX_HOME ?? "未设置"}`,
  );
  process.exit(1);
}

const publicHost = process.env.CODEX_WEB_PUBLIC_HOST ?? "192.168.3.12";
const devOrigins = [3000, 3001].flatMap((port) => [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
  `http://${publicHost}:${port}`,
]);
const bridge = createWebSocketBridge({
  host: "0.0.0.0",
  allowedOrigins: devOrigins,
  allowRemoteConnections: true,
  clientMessageInterceptor: createThreadTurnsListFailureInterceptorFromEnv(process.env),
});
await waitForListening(bridge.server);

const address = bridge.server.address();
const bridgePort =
  typeof address === "object" && address !== null
    ? address.port
    : 0;
const bridgeUrl = `ws://${publicHost}:${bridgePort}?token=${bridge.token}`;
console.log(`Codex Web bridge: ${bridgeUrl}`);
console.log(`Codex app-server PID: ${bridge.appServerPid ?? "未知"}`);

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
