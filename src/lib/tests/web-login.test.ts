import { describe, expect, it } from "vitest";

import {
  buildSsoLoginPath,
  canSubmitLogin,
  resolveLoginDestination,
  turnstileClientErrorCode,
} from "../web-login";

describe("登录页纯逻辑", () => {
  it("只接受站内 next 路径", () => {
    expect(resolveLoginDestination("/settings/security?tab=turnstile")).toBe("/settings/security?tab=turnstile");
    expect(resolveLoginDestination("https://example.com")).toBe("/chat");
    expect(resolveLoginDestination("//example.com")).toBe("/chat");
    expect(resolveLoginDestination(null)).toBe("/chat");
  });

  it("SSO 登录入口带有唯一的缓存破坏参数", () => {
    expect(buildSsoLoginPath("/settings/security?tab=sso", "login-1")).toBe(
      "/api/auth/sso/login?next=%2Fsettings%2Fsecurity%3Ftab%3Dsso&cacheBust=login-1",
    );
    expect(buildSsoLoginPath("https://example.com", "login-2")).toBe(
      "/api/auth/sso/login?next=%2Fchat&cacheBust=login-2",
    );
  });

  it("Turnstile 启用时必须先获得 token", () => {
    expect(canSubmitLogin(false, false, "")).toBe(false);
    expect(canSubmitLogin(true, false, "")).toBe(true);
    expect(canSubmitLogin(true, true, "")).toBe(false);
    expect(canSubmitLogin(true, true, "token")).toBe(true);
  });

  it("只保留 Cloudflare 六位数字客户端错误码", () => {
    expect(turnstileClientErrorCode("110200")).toBe("110200");
    expect(turnstileClientErrorCode(300030)).toBe("300030");
    expect(turnstileClientErrorCode("Turnstile 脚本加载失败")).toBeNull();
  });
});
