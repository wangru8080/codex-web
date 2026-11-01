import type { IncomingMessage } from "node:http";
import type WebSocket from "ws";

const maxDetailLength = 240;

function quote(value: string): string {
  return JSON.stringify(value.slice(0, maxDetailLength));
}

export function observeBridgeSocket(
  label: string,
  webSocket: WebSocket,
  request: IncomingMessage,
): void {
  const startedAt = Date.now();
  const remote = request.socket.remoteAddress ?? "unknown";
  const userAgent = request.headers["user-agent"] ?? "unknown";
  console.info(`[${label}] socket connected remote=${remote} userAgent=${quote(userAgent)}`);

  webSocket.once("error", (error) => {
    console.warn(
      `[${label}] socket error remote=${remote} durationMs=${Date.now() - startedAt} ` +
        `error=${quote(error.message)}`,
    );
  });

  webSocket.once("close", (code, reason) => {
    console.info(
      `[${label}] socket closed remote=${remote} code=${code} ` +
        `reason=${quote(reason.toString("utf8"))} durationMs=${Date.now() - startedAt}`,
    );
  });
}
