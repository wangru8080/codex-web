import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";

import { RuntimeBrokerClient } from "./runtime-broker-client";
import type { BrokerPublicUser } from "./runtime-broker-protocol";

export const WEB_AUTH_COOKIE = "codex_web_session";
export const WEB_AUTH_MAX_AGE_SECONDS = 3 * 24 * 60 * 60;
const WEB_AUTH_SESSION_VERSION = 2;

export type WebAuthConfig = {
  email: string;
  password: string;
  sessionSecret: string;
};

type SessionPayload = {
  version: number;
  email: string;
  credentialVersion: string;
  expiresAt: number;
};

export function readWebAuthConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): WebAuthConfig {
  const email = env.CODEX_WEB_LOGIN_EMAIL?.trim();
  const password = env.CODEX_WEB_LOGIN_PASSWORD ?? "";
  const sessionSecret = env.CODEX_WEB_SESSION_SECRET ?? "";
  if (!email) throw new Error("CODEX_WEB_LOGIN_EMAIL 未设置");
  if (!password) throw new Error("CODEX_WEB_LOGIN_PASSWORD 未设置");
  if (sessionSecret.length < 32) throw new Error("CODEX_WEB_SESSION_SECRET 必须至少 32 个字符");
  return { email, password, sessionSecret };
}

export function verifyCredentials(email: string, password: string, config: WebAuthConfig): boolean {
  return constantTimeEqual(email.trim(), config.email) && constantTimeEqual(password, config.password);
}

export function createSessionToken(config: WebAuthConfig, now = Date.now()): string {
  const payload: SessionPayload = {
    version: WEB_AUTH_SESSION_VERSION,
    email: config.email,
    credentialVersion: credentialVersion(config),
    expiresAt: now + WEB_AUTH_MAX_AGE_SECONDS * 1_000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, config.sessionSecret)}`;
}

export function verifySessionToken(
  token: string | undefined,
  config: WebAuthConfig,
  now = Date.now(),
): SessionPayload | null {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!constantTimeEqual(signature, sign(encoded, config.sessionSecret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (
      payload.version !== WEB_AUTH_SESSION_VERSION
      || payload.email !== config.email
      || payload.credentialVersion !== credentialVersion(config)
      || typeof payload.expiresAt !== "number"
      || payload.expiresAt <= now
    ) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export function readSessionCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === WEB_AUTH_COOKIE) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function isAuthenticatedRequest(request: Request, env = process.env): boolean {
  try {
    const config = readWebAuthConfig(env);
    return verifySessionToken(readSessionCookie(request.headers.get("cookie")), config) !== null;
  } catch {
    return false;
  }
}

export function runtimeBrokerSocket(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  return env.CODEX_WEB_RUNTIME_BROKER_SOCKET?.trim() || null;
}

export async function authenticateWebRequest(
  request: Request,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<BrokerPublicUser | null> {
  const brokerSocket = runtimeBrokerSocket(env);
  let token: string | undefined;
  try {
    token = readSessionCookie(request.headers.get("cookie"));
  } catch {
    return null;
  }
  if (brokerSocket) {
    if (!token) return null;
    try {
      return await new RuntimeBrokerClient(brokerSocket).verifySession(token);
    } catch {
      return null;
    }
  }
  try {
    const config = readWebAuthConfig(env);
    const session = verifySessionToken(token, config);
    if (!session) return null;
    const home = env.CODEX_WEB_HOME_DIRECTORY?.trim() || homedir();
    return {
      id: config.email,
      email: config.email,
      osUser: env.USER?.trim() || config.email,
      home,
      codexHome: env.CODEX_HOME?.trim() || home,
      cwd: process.cwd(),
      role: "admin",
    };
  } catch {
    return null;
  }
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const requestHost = request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

function credentialVersion(config: WebAuthConfig): string {
  return createHmac("sha256", config.sessionSecret)
    .update(`${config.email}\0${config.password}`)
    .digest("base64url")
    .slice(0, 22);
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
