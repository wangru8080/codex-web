import { spawn } from "node:child_process";

import { createWebSocketBridge } from "../server/websocket-bridge";

if (!process.env.CODEX_HOME) {
  console.error("start 必须显式设置 CODEX_HOME；可在当前 shell 或 .bashrc 中 export CODEX_HOME。");
  process.exit(1);
}

const publicHost = process.env.CODEX_WEB_PUBLIC_HOST ?? "192.168.3.12";
const nextHost = process.env.CODEX_WEB_NEXT_HOST ?? "0.0.0.0";
const nextPort = process.env.PORT ?? "3000";
const allowedOrigins = [nextPort].flatMap((port) => [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
  `http://${publicHost}:${port}`,
]);

const bridge = createWebSocketBridge({
  host: "0.0.0.0",
  allowedOrigins,
  allowRemoteConnections: true,
  codexHome: process.env.CODEX_HOME,
});
await waitForListening(bridge.server);

const address = bridge.server.address();
const bridgePort =
  typeof address === "object" && address !== null
    ? address.port
    : 0;
const bridgeUrl = `ws://${publicHost}:${bridgePort}?token=${bridge.token}`;
console.log(`Codex Web bridge: ${bridgeUrl}`);
console.log(`Codex Web CODEX_HOME: ${process.env.CODEX_HOME}`);

const next = spawn("next", ["start", "--hostname", nextHost, "--port", nextPort], {
  stdio: "inherit",
  env: {
    ...process.env,
    CODEX_WEB_BRIDGE_URL: bridgeUrl,
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
