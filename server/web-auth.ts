import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";

import { RuntimeBrokerClient } from "./runtime-broker-client";
import type { BrokerPublicUser } from "./runtime-broker-protocol";
import {
  isEmailAllowedBySsoConfig,
  readSsoConfigSync,
  type SsoConfig,
} from "./sso-config";

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

export function readSessionSecret(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  const sessionSecret = env.CODEX_WEB_SESSION_SECRET ?? "";
  if (sessionSecret.length < 32) throw new Error("CODEX_WEB_SESSION_SECRET 必须至少 32 个字符");
  return sessionSecret;
}

export function readWebAuthConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): WebAuthConfig {
  const email = env.CODEX_WEB_LOGIN_EMAIL?.trim();
  const password = env.CODEX_WEB_LOGIN_PASSWORD ?? "";
  if (!email) throw new Error("CODEX_WEB_LOGIN_EMAIL 未设置");
  if (!password) throw new Error("CODEX_WEB_LOGIN_PASSWORD 未设置");
  const sessionSecret = readSessionSecret(env);
  return { email, password, sessionSecret };
}

export function assertWebAuthStartupConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): void {
  const sso = readSsoConfigSync(env);
  if (sso.enabled) {
    readSessionSecret(env);
    if (!sso.issuer) throw new Error("SSO mode is enabled, but OIDC Issuer URL is not configured");
    if (!sso.clientId) throw new Error("SSO mode is enabled, but OIDC Client ID is not configured");
    if (!sso.clientSecret) throw new Error("SSO mode is enabled, but OIDC Client Secret is not configured");
    return;
  }
  readWebAuthConfig(env);
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

export function createSsoSessionToken(
  email: string,
  sso: SsoConfig,
  sessionSecret: string,
  now = Date.now(),
): string {
  const normalizedEmail = email.trim().toLowerCase();
  const payload: SessionPayload = {
    version: WEB_AUTH_SESSION_VERSION,
    email: normalizedEmail,
    credentialVersion: ssoCredentialVersion(sso, sessionSecret),
    expiresAt: now + WEB_AUTH_MAX_AGE_SECONDS * 1_000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, sessionSecret)}`;
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

export function verifySsoSessionToken(
  token: string | undefined,
  sso: SsoConfig,
  sessionSecret: string,
  now = Date.now(),
): SessionPayload | null {
  if (!token || !sso.enabled) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!constantTimeEqual(signature, sign(encoded, sessionSecret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (
      payload.version !== WEB_AUTH_SESSION_VERSION
      || typeof payload.email !== "string"
      || !isEmailAllowedBySsoConfig(payload.email, sso)
      || payload.credentialVersion !== ssoCredentialVersion(sso, sessionSecret)
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
    const token = readSessionCookie(request.headers.get("cookie"));
    const sso = readSsoConfigSync(env);
    if (sso.enabled) {
      return verifySsoSessionToken(token, sso, readSessionSecret(env)) !== null;
    }
    const config = readWebAuthConfig(env);
    return verifySessionToken(token, config) !== null;
  } catch {
    return false;
  }
}

export function runtimeBrokerSocket(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  return env.CODEX_WEB_RUNTIME_BROKER_SOCKET?.trim() || null;
}

/**
 * Fingerprint of the browser-auth configuration that an API key is bound to.
 * The value contains only a one-way digest so it can live in the broker key
 * store without exposing credentials. Broker-managed local passwords are not
 * available to the Web process; the broker separately binds the user's
 * credential version to the key.
 */
export function readWebAuthBinding(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const sso = readSsoConfigSync(env);
  if (sso.enabled) {
    return digestAuthBinding([
      "sso",
      readSessionSecret(env),
      sso.issuer,
      sso.clientId,
      sso.clientSecret,
      sso.scopes,
      "allowed-emails",
      ...sso.allowedEmails.map((email) => email.trim().toLowerCase()).sort(),
      "allowed-domains",
      ...sso.allowedDomains.map((domain) => domain.trim().toLowerCase()).sort(),
    ]);
  }
  if (runtimeBrokerSocket(env)) return digestAuthBinding(["local", "broker"]);
  const local = readWebAuthConfig(env);
  return digestAuthBinding(["local", local.email, local.password, local.sessionSecret]);
}

export function webAuthCredentialVersion(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  try {
    const sso = readSsoConfigSync(env);
    if (sso.enabled) {
      return ssoCredentialVersion(sso, readSessionSecret(env));
    }
    if (runtimeBrokerSocket(env)) return null;
    return credentialVersion(readWebAuthConfig(env));
  } catch {
    return null;
  }
}

export function isBrokerUserAllowedByCurrentWebAuth(
  user: Pick<BrokerPublicUser, "email">,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  try {
    const sso = readSsoConfigSync(env);
    return !sso.enabled || isEmailAllowedBySsoConfig(user.email, sso);
  } catch {
    return false;
  }
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
    const sso = readSsoConfigSync(env);
    const session = sso.enabled
      ? verifySsoSessionToken(token, sso, readSessionSecret(env))
      : verifySessionToken(token, readWebAuthConfig(env));
    if (!session) return null;
    const home = env.CODEX_WEB_HOME_DIRECTORY?.trim() || homedir();
    return {
      id: session.email,
      email: session.email,
      osUser: env.USER?.trim() || session.email,
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
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
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

function ssoCredentialVersion(sso: SsoConfig, sessionSecret: string): string {
  return createHmac("sha256", sessionSecret)
    .update(`sso\0${sso.issuer}\0${sso.clientId}\0${sso.clientSecret}`)
    .digest("base64url")
    .slice(0, 22);
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function digestAuthBinding(values: string[]): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
