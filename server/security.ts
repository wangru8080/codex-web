import type { IncomingMessage } from "node:http";

export type BridgeSecurityOptions = {
  token: string;
  allowedOrigins?: string[];
  allowRemoteConnections?: boolean;
};

export type BridgeSecurityResult =
  | { ok: true }
  | { ok: false; statusCode: number; message: string };

export function validateBridgeRequest(
  request: IncomingMessage,
  options: BridgeSecurityOptions,
): BridgeSecurityResult {
  if (!options.allowRemoteConnections && !isLocalhost(request.socket.remoteAddress)) {
    return { ok: false, statusCode: 403, message: "只允许 localhost 连接" };
  }

  const token = readToken(request);
  if (token !== options.token) {
    return { ok: false, statusCode: 401, message: "bridge token 无效" };
  }

  const origin = request.headers.origin;
  if (origin && !isAllowedOrigin(origin, options.allowedOrigins)) {
    return { ok: false, statusCode: 403, message: "Origin 不在允许列表" };
  }

  return { ok: true };
}

export function isLocalhost(address: string | undefined): boolean {
  return (
    address === undefined ||
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function readToken(request: IncomingMessage): string | undefined {
  const auth = request.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length);
  }

  const url = request.url ? new URL(request.url, "http://localhost") : undefined;
  return url?.searchParams.get("token") ?? undefined;
}

function isAllowedOrigin(origin: string, allowedOrigins: string[] | undefined): boolean {
  if (!allowedOrigins || allowedOrigins.length === 0) {
    return origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
  }

  return allowedOrigins.includes(origin);
}
