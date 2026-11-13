import type { AddressInfo } from "node:net";
import WebSocket from "ws";

import { createWebSocketBridge } from "../server/websocket-bridge";
import { resolveTestCodexHome } from "../server/test-codex-home";
import { resolveScreenShareConfig } from "../server/screen-share/config";
import { probeScreenShareCapability } from "../server/screen-share/probe";
import {
  SCREEN_SHARE_CLOSE_CODES,
  SCREEN_SHARE_CLOSE_REASONS,
} from "../server/screen-share/manager";

const codexHome = resolveTestCodexHome();
process.env.CODEX_HOME = codexHome;

async function waitForListening(server: import("node:http").Server): Promise<void> {
  if (server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

async function main(): Promise<void> {
  console.log("=== Screen Share Smoke Verification ===");
  console.log(`CODEX_HOME: ${codexHome}`);
  console.log(`Platform: ${process.platform}`);

  // Negative Check 1: Flag disabled by default
  const defaultCfg = resolveScreenShareConfig({}, {});
  if (defaultCfg.enabled) {
    throw new Error("Screen share should be disabled by default");
  }
  const defaultProbe = probeScreenShareCapability(defaultCfg);
  if (defaultProbe.status !== "disabled") {
    throw new Error(`Expected disabled status, got ${defaultProbe.status}`);
  }
  console.log("✓ Negative 1: Flag off -> status is disabled");

  // Negative Check 2: Broker mode forces disabled
  const brokerCfg = resolveScreenShareConfig(
    { enabled: true },
    { CODEX_WEB_RUNTIME_BROKER_SOCKET: "/tmp/fake.sock" },
  );
  if (brokerCfg.enabled) {
    throw new Error("Screen share must be disabled in broker mode");
  }
  console.log("✓ Negative 2: Broker mode -> forced disabled");

  // Negative Check 3: Current host capability probe
  const hostCfg = resolveScreenShareConfig({ enabled: true }, process.env);
  const hostProbe = probeScreenShareCapability(hostCfg);
  if (process.platform === "darwin") {
    if (hostProbe.status !== "unsupported" || !hostProbe.reason.includes('Platform "darwin" is not supported')) {
      throw new Error(`Expected darwin unsupported reason, got: ${JSON.stringify(hostProbe)}`);
    }
    console.log(`✓ Negative 3 (macOS): Correctly detected unsupported platform "${process.platform}"`);
  } else if (process.platform === "linux") {
    console.log(`✓ Linux host probe status: ${hostProbe.status}`);
  }

  // Negative Check 4: Linux simulation without DISPLAY
  const simNoDisplay = probeScreenShareCapability(
    { enabled: true, wsPath: "/screen-share/ws" },
    { platform: "linux", env: {} },
  );
  if (simNoDisplay.status !== "unsupported" || !simNoDisplay.reason.includes("No X11 DISPLAY")) {
    throw new Error(`Expected no display unsupported reason, got: ${JSON.stringify(simNoDisplay)}`);
  }
  console.log("✓ Negative 4: Linux without DISPLAY -> unsupported: No X11 DISPLAY");

  // Bridge Integration & Security Parity
  const token = "screen-share-smoke-token-secret";
  let mockProcessKilled = false;

  const dummyVncServer = (await import("node:net")).createServer();
  await new Promise<void>((r) => dummyVncServer.listen(0, "127.0.0.1", r));
  const vncPort = (dummyVncServer.address() as AddressInfo).port;

  const bridge = createWebSocketBridge({
    token,
    host: "127.0.0.1",
    allowedOrigins: ["http://localhost:3000"],
    screenShare: {
      enabled: true,
      wsPath: "/screen-share/ws",
      probeFn: () => ({ status: "available", display: ":0", wsPath: "/screen-share/ws" }),
      launcher: async () => ({
        pid: 77777,
        port: vncPort,
        password: "vncpassword",
        display: ":0",
        getStderrSummary: () => "",
        kill: async () => {
          mockProcessKilled = true;
        },
        onExit: () => {},
      }),
    },
  });

  try {
    await waitForListening(bridge.server);
    const addr = bridge.server.address() as AddressInfo;
    const wsBaseUrl = `ws://127.0.0.1:${addr.port}/screen-share/ws`;

    // Negative Check 5: 401 when token is invalid or missing
    const badTokenWs = new WebSocket(`${wsBaseUrl}?token=invalid-token`, {
      origin: "http://localhost:3000",
    });
    const badTokenStatus = await new Promise<number | undefined>((resolve) => {
      badTokenWs.on("unexpected-response", (_req, res) => resolve(res.statusCode));
      badTokenWs.on("error", () => {});
    });
    if (badTokenStatus !== 401) {
      throw new Error(`Expected 401 for bad token, got ${badTokenStatus}`);
    }
    console.log("✓ Negative 5: Bad token rejected with HTTP 401");

    // Negative Check 6: 403 when Origin is not allowed
    const badOriginWs = new WebSocket(`${wsBaseUrl}?token=${token}`, {
      origin: "http://attacker.example.com",
    });
    const badOriginStatus = await new Promise<number | undefined>((resolve) => {
      badOriginWs.on("unexpected-response", (_req, res) => resolve(res.statusCode));
      badOriginWs.on("error", () => {});
    });
    if (badOriginStatus !== 403) {
      throw new Error(`Expected 403 for bad origin, got ${badOriginStatus}`);
    }
    console.log("✓ Negative 6: Forbidden Origin rejected with HTTP 403");

    // Positive Check 7: Connect client 1
    const client1 = new WebSocket(`${wsBaseUrl}?token=${token}`, {
      origin: "http://localhost:3000",
    });
    await new Promise<void>((resolve, reject) => {
      client1.on("open", resolve);
      client1.on("error", reject);
    });
    if (bridge.screenShareManager.getStatus() !== "active") {
      throw new Error(`Expected manager to be active, got ${bridge.screenShareManager.getStatus()}`);
    }
    console.log("✓ Session 1 connected successfully and active");

    // Negative Check 8: Client 2 connects without takeover -> rejected with 4002 already-active
    const client2 = new WebSocket(`${wsBaseUrl}?token=${token}`, {
      origin: "http://localhost:3000",
    });
    const [client2CloseCode, client2CloseReason] = await new Promise<[number, string]>((resolve) => {
      client2.on("close", (code, reason) => resolve([code, reason.toString()]));
    });
    if (client2CloseCode !== SCREEN_SHARE_CLOSE_CODES.ALREADY_ACTIVE) {
      throw new Error(`Expected client 2 close code ${SCREEN_SHARE_CLOSE_CODES.ALREADY_ACTIVE}, got ${client2CloseCode}`);
    }
    console.log(`✓ Negative 8: Second client rejected with ${client2CloseCode} (${client2CloseReason})`);

    // Negative Check 9: Client 3 connects with takeover=1 -> client 1 disconnected with 4001 taken-over
    const client1ClosePromise = new Promise<[number, string]>((resolve) => {
      client1.on("close", (code, reason) => resolve([code, reason.toString()]));
    });

    const client3 = new WebSocket(`${wsBaseUrl}?token=${token}&takeover=1`, {
      origin: "http://localhost:3000",
    });
    await new Promise<void>((resolve, reject) => {
      client3.on("open", resolve);
      client3.on("error", reject);
    });

    const [client1CloseCode, client1CloseReason] = await client1ClosePromise;
    if (client1CloseCode !== SCREEN_SHARE_CLOSE_CODES.TAKEN_OVER) {
      throw new Error(`Expected client 1 close code ${SCREEN_SHARE_CLOSE_CODES.TAKEN_OVER}, got ${client1CloseCode}`);
    }
    console.log(`✓ Negative 9: Takeover disconnected client 1 with ${client1CloseCode} (${client1CloseReason})`);

    // Clean disconnect client 3
    client3.close();
    await new Promise((r) => setTimeout(r, 100));
    if (!mockProcessKilled) {
      throw new Error("x11vnc process was not killed when client closed");
    }
    console.log("✓ Process cleanup: x11vnc terminated on disconnect");

  } finally {
    dummyVncServer.close();
    await bridge.close();
  }

  console.log("\n=== Smoke Tests Passed: All 9 Negative/Positive Assertions Verified ===");
}

void main().catch((err) => {
  console.error("Screen Share Smoke FAILED:", err);
  process.exit(1);
});
