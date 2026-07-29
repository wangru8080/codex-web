import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type {
  RuntimeBrokerConfig,
  RuntimeBrokerUserConfig,
} from "./runtime-broker-config";

const SESSION_VERSION = 1;

type BrokerSessionPayload = {
  version: number;
  sub: string;
  email: string;
  role: string;
  credentialVersion: string;
  expiresAt: number;
  sessionId: string;
};

export function createBrokerSession(
  user: RuntimeBrokerUserConfig,
  config: RuntimeBrokerConfig,
  now = Date.now(),
): string {
  if (!user.enabled) throw new Error("用户已禁用");
  const payload: BrokerSessionPayload = {
    version: SESSION_VERSION,
    sub: user.id,
    email: user.email,
    role: user.role,
    credentialVersion: credentialVersion(user, config.sessionSecret),
    expiresAt: now + config.sessionMaxAgeSeconds * 1_000,
    sessionId: randomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, config.sessionSecret)}`;
}

export function verifyBrokerSession(
  token: string | undefined,
  config: RuntimeBrokerConfig,
  now = Date.now(),
): RuntimeBrokerUserConfig | null {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!constantTimeEqual(signature, sign(encoded, config.sessionSecret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<BrokerSessionPayload>;
    if (
      payload.version !== SESSION_VERSION
      || typeof payload.sub !== "string"
      || typeof payload.expiresAt !== "number"
      || payload.expiresAt <= now
    ) return null;
    const user = config.users.find((candidate) => candidate.id === payload.sub);
    if (
      !user?.enabled
      || payload.email !== user.email
      || payload.role !== user.role
      || payload.credentialVersion !== credentialVersion(user, config.sessionSecret)
    ) return null;
    return user;
  } catch {
    return null;
  }
}

function credentialVersion(user: RuntimeBrokerUserConfig, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${user.id}\0${user.passwordHash}\0${String(user.enabled)}\0${user.role}`)
    .digest("base64url")
    .slice(0, 24);
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
