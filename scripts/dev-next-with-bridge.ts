import { spawn } from "node:child_process";

import { createWebSocketBridge } from "../server/websocket-bridge";

const requiredCodexHome = "/volume2/SSD/codex/Temp/codex-dev-home";

if (process.env.CODEX_HOME !== requiredCodexHome) {
  console.error(
    `dev 必须使用隔离 CODEX_HOME：${requiredCodexHome}，当前为 ${process.env.CODEX_HOME ?? "未设置"}`,
  );
  process.exit(1);
}

const publicHost = process.env.CODEX_WEB_PUBLIC_HOST ?? "192.168.3.12";
const bridge = createWebSocketBridge({
  host: "0.0.0.0",
  allowedOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    `http://${publicHost}:3000`,
  ],
  allowRemoteConnections: true,
});
await waitForListening(bridge.server);

const address = bridge.server.address();
const bridgePort =
  typeof address === "object" && address !== null
    ? address.port
    : 0;
const bridgeUrl = `ws://${publicHost}:${bridgePort}?token=${bridge.token}`;
console.log(`Codex Web bridge: ${bridgeUrl}`);

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
