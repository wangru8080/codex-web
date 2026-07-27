import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  WEB_AUTH_MAX_AGE_SECONDS,
  readWebAuthConfig,
  verifyCredentials,
  verifySessionToken,
  isSameOriginRequest,
} from "../web-auth";

const env = {
  CODEX_WEB_LOGIN_EMAIL: "test@admin.com",
  CODEX_WEB_LOGIN_PASSWORD: "123456",
  CODEX_WEB_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("Web 登录认证", () => {
  it("只接受环境变量中配置的邮箱和密码", () => {
    const config = readWebAuthConfig(env);
    expect(verifyCredentials("test@admin.com", "123456", config)).toBe(true);
    expect(verifyCredentials("other@admin.com", "123456", config)).toBe(false);
    expect(verifyCredentials("test@admin.com", "wrong", config)).toBe(false);
  });

  it("拒绝不完整或过短的运行时配置", () => {
    expect(() => readWebAuthConfig({})).toThrow("CODEX_WEB_LOGIN_EMAIL");
    expect(() => readWebAuthConfig({ ...env, CODEX_WEB_SESSION_SECRET: "short" })).toThrow(
      "至少 32 个字符",
    );
  });

  it("验证签名会话并拒绝篡改、三天过期和凭据变更", () => {
    const config = readWebAuthConfig(env);
    const now = 1_800_000_000_000;
    const token = createSessionToken(config, now);

    expect(verifySessionToken(token, config, now + 1_000)?.email).toBe("test@admin.com");
    expect(verifySessionToken(token, config, now + WEB_AUTH_MAX_AGE_SECONDS * 1_000 - 1)).not.toBeNull();
    expect(verifySessionToken(`${token}x`, config, now + 1_000)).toBeNull();
    expect(verifySessionToken(token, config, now + WEB_AUTH_MAX_AGE_SECONDS * 1_000)).toBeNull();

    const changed = readWebAuthConfig({ ...env, CODEX_WEB_LOGIN_PASSWORD: "654321" });
    expect(verifySessionToken(token, changed, now + 1_000)).toBeNull();
  });

  it("拒绝版本升级前签发的会话", () => {
    const config = readWebAuthConfig(env);
    const now = 1_800_000_000_000;
    const legacyPayload = Buffer.from(JSON.stringify({
      email: config.email,
      credentialVersion: createHmac("sha256", config.sessionSecret)
        .update(`${config.email}\0${config.password}`)
        .digest("base64url")
        .slice(0, 22),
      expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
    })).toString("base64url");
    const legacyToken = `${legacyPayload}.${createHmac("sha256", config.sessionSecret)
      .update(legacyPayload)
      .digest("base64url")}`;

    expect(verifySessionToken(legacyToken, config, now + 1_000)).toBeNull();
  });

  it("自托管时按 Host 头校验 Origin", () => {
    expect(isSameOriginRequest(new Request("http://0.0.0.0/login", {
      headers: { host: "127.0.0.1:3001", origin: "http://127.0.0.1:3001" },
    }))).toBe(true);
    expect(isSameOriginRequest(new Request("http://0.0.0.0/login", {
      headers: { host: "127.0.0.1:3001", origin: "https://example.com" },
    }))).toBe(false);
  });
});
