import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  authenticateWebRequest,
  createSessionToken,
  WEB_AUTH_COOKIE,
  WEB_AUTH_MAX_AGE_SECONDS,
  readWebAuthConfig,
  verifyCredentials,
  verifySessionToken,
  isSameOriginRequest,
  isBrokerUserAllowedByCurrentWebAuth,
  readWebAuthBinding,
  webAuthCredentialVersion,
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
    expect(isSameOriginRequest(new Request("http://0.0.0.0/login", {
      headers: { host: "127.0.0.1:3001", "sec-fetch-site": "cross-site" },
    }))).toBe(false);
    expect(isSameOriginRequest(new Request("http://0.0.0.0/login", {
      headers: { host: "127.0.0.1:3001", "sec-fetch-site": "same-origin" },
    }))).toBe(true);
  });

  it("畸形 Cookie 按未登录处理而不是抛出异常", async () => {
    const request = new Request("http://localhost/chat", {
      headers: { cookie: `${WEB_AUTH_COOKIE}=%` },
    });
    await expect(authenticateWebRequest(request, env)).resolves.toBeNull();
  });

  it("API key 绑定随本地凭据和会话密钥变化，健康配置保持稳定", () => {
    const binding = readWebAuthBinding(env);
    const credentialVersion = webAuthCredentialVersion(env);

    expect(readWebAuthBinding(env)).toBe(binding);
    expect(webAuthCredentialVersion(env)).toBe(credentialVersion);
    expect(readWebAuthBinding({ ...env, CODEX_WEB_LOGIN_PASSWORD: "654321" })).not.toBe(binding);
    expect(readWebAuthBinding({
      ...env,
      CODEX_WEB_SESSION_SECRET: "abcdef0123456789abcdef0123456789",
    })).not.toBe(binding);
    expect(webAuthCredentialVersion({ ...env, CODEX_WEB_LOGIN_PASSWORD: "654321" }))
      .not.toBe(credentialVersion);
  });

  it("SSO API key 绑定包含 provider 与 allowlist，broker 会话另行绑定用户凭据", () => {
    const ssoEnv = {
      ...env,
      CODEX_WEB_AUTH_MODE: "sso",
      CODEX_WEB_OIDC_ISSUER: "https://idp.example.test",
      CODEX_WEB_OIDC_CLIENT_ID: "codex-web",
      CODEX_WEB_OIDC_CLIENT_SECRET: "oidc-secret",
      CODEX_WEB_OIDC_SCOPES: "openid email profile",
      CODEX_WEB_OIDC_ALLOWED_DOMAINS: "example.test",
    };
    const binding = readWebAuthBinding(ssoEnv);
    const credentialVersion = webAuthCredentialVersion(ssoEnv);

    expect(readWebAuthBinding(ssoEnv)).toBe(binding);
    expect(readWebAuthBinding({
      ...ssoEnv,
      CODEX_WEB_OIDC_ALLOWED_DOMAINS: "example.test,other.test",
    })).not.toBe(binding);
    expect(readWebAuthBinding({ ...ssoEnv, CODEX_WEB_OIDC_SCOPES: "openid email" }))
      .not.toBe(binding);
    expect(webAuthCredentialVersion({ ...ssoEnv, CODEX_WEB_OIDC_CLIENT_SECRET: "rotated" }))
      .not.toBe(credentialVersion);
    expect(isBrokerUserAllowedByCurrentWebAuth({ email: "alice@example.test" }, ssoEnv)).toBe(true);
    expect(isBrokerUserAllowedByCurrentWebAuth({ email: "alice@other.test" }, ssoEnv)).toBe(false);

    const brokerEnv = { ...env, CODEX_WEB_RUNTIME_BROKER_SOCKET: "/run/codex-web-broker.sock" };
    expect(readWebAuthBinding(brokerEnv)).toBe(readWebAuthBinding({
      ...brokerEnv,
      CODEX_WEB_LOGIN_PASSWORD: "different-password",
    }));
    expect(webAuthCredentialVersion(brokerEnv)).toBeNull();
  });
});
