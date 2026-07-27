import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionToken, readWebAuthConfig, WEB_AUTH_COOKIE } from "../../../server/web-auth";
import { config as proxyConfig, isPublicWebAuthPath, proxy } from "../../proxy";

const authEnv = {
  CODEX_WEB_LOGIN_EMAIL: "test@admin.com",
  CODEX_WEB_LOGIN_PASSWORD: "123456",
  CODEX_WEB_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

describe("Web 登录路由门禁", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(authEnv)) vi.stubEnv(key, value);
    vi.stubEnv("CODEX_WEB_DEMO", "0");
  });

  it("只公开登录页、登录提交和公开配置", () => {
    expect(isPublicWebAuthPath("/login")).toBe(true);
    expect(isPublicWebAuthPath("/api/auth/config")).toBe(true);
    expect(isPublicWebAuthPath("/api/auth/login")).toBe(true);
    expect(isPublicWebAuthPath("/api/auth/logout")).toBe(false);
    expect(isPublicWebAuthPath("/api/codex/bridge-url")).toBe(false);
    expect(proxyConfig.matcher[0]).not.toContain("png|jpg");
  });

  it("未登录访问页面时带安全 next 参数跳转登录页", () => {
    const response = proxy(new NextRequest("http://localhost:3000/chat?id=1"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fchat%3Fid%3D1");
  });

  it("未登录 API 返回 401 而不是 HTML 重定向", async () => {
    const response = proxy(new NextRequest("http://localhost:3000/api/codex/bridge-url"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "登录已失效" });
  });

  it("有效 Cookie 放行应用并把登录页送回聊天页", () => {
    const token = createSessionToken(readWebAuthConfig(authEnv));
    const headers = { cookie: `${WEB_AUTH_COOKIE}=${token}` };
    expect(proxy(new NextRequest("http://localhost:3000/chat", { headers })).status).toBe(200);
    const response = proxy(new NextRequest("http://localhost:3000/login", { headers }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/chat");
  });
});
