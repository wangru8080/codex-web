import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  readWebAuthConfig,
  verifyCredentials,
  verifySessionToken,
  isSameOriginRequest,
} from "./web-auth";

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

  it("验证签名会话并拒绝篡改、过期和凭据变更", () => {
    const config = readWebAuthConfig(env);
    const now = 1_800_000_000_000;
    const token = createSessionToken(config, now);

    expect(verifySessionToken(token, config, now + 1_000)?.email).toBe("test@admin.com");
    expect(verifySessionToken(`${token}x`, config, now + 1_000)).toBeNull();
    expect(verifySessionToken(token, config, now + 8 * 24 * 60 * 60 * 1_000)).toBeNull();

    const changed = readWebAuthConfig({ ...env, CODEX_WEB_LOGIN_PASSWORD: "654321" });
    expect(verifySessionToken(token, changed, now + 1_000)).toBeNull();
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
