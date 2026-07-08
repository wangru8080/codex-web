import WebSocket from "ws";

import { createWebSocketBridge } from "../dist/server/websocket-bridge.js";

const requiredCodexHome = "/volume2/SSD/codex/Temp/codex-dev-home";

if (process.env.CODEX_HOME !== requiredCodexHome) {
  console.error(
    `smoke 必须使用隔离 CODEX_HOME：${requiredCodexHome}，当前为 ${process.env.CODEX_HOME ?? "未设置"}`,
  );
  process.exit(1);
}

const bridge = createWebSocketBridge({ token: "smoke-token" });

try {
  await waitForListening(bridge.server);
  const socket = new WebSocket(`${bridge.url()}?token=${bridge.token}`);
  const response = await roundTripInitialize(socket);

  if (response.result?.codexHome !== requiredCodexHome) {
    throw new Error(`app-server 使用了错误 CODEX_HOME：${response.result?.codexHome}`);
  }

  socket.close();
  console.log(`smoke bridge 通过：CODEX_HOME=${response.result.codexHome}`);
} finally {
  await bridge.close();
}

function waitForListening(server) {
  if (server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve) => server.once("listening", resolve));
}

function roundTripInitialize(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("等待 initialize response 超时")), 10_000);

    socket.once("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "initialize",
          params: {
            clientInfo: {
              name: "codex_web_smoke",
              title: "Codex Web Smoke",
              version: "0.0.0",
            },
          },
        }),
      );
    });

    socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8"));
      if (message.id === 1) {
        clearTimeout(timeout);
        resolve(message);
      }
    });

    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
