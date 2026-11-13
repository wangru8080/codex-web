import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("expired-session SSO login wiring", () => {
  const loginForm = readFileSync(resolve(process.cwd(), "src/components/auth/LoginForm.tsx"), "utf8");

  it("每次 SSO 登录都生成唯一入口，避免复用缓存的重定向", () => {
    expect(loginForm).toContain("crypto.randomUUID()");
    expect(loginForm).toContain("buildSsoLoginPath(destination, cacheBuster)");
    expect(loginForm).not.toContain("window.location.assign(`/api/auth/sso/login?next=");
  });
});
