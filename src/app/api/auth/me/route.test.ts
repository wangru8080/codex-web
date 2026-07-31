import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const authenticateWebRequest = vi.hoisted(() => vi.fn());

vi.mock("../../../../../server/web-auth", () => ({ authenticateWebRequest }));

describe("认证用户诊断 API", () => {
  it("未认证时返回 401", async () => {
    authenticateWebRequest.mockResolvedValueOnce(null);

    const response = await GET(new NextRequest("http://localhost/api/auth/me"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "登录已失效" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("返回公开用户 breadcrumb，不返回凭据", async () => {
    authenticateWebRequest.mockResolvedValueOnce({
      id: "alice",
      email: "alice@example.test",
      osUser: "alice",
      home: "/home/alice",
      codexHome: "/srv/alice/.codex",
      cwd: "/srv/alice/project",
      role: "admin",
    });

    const response = await GET(new NextRequest("http://localhost/api/auth/me"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      user: {
        id: "alice",
        email: "alice@example.test",
        osUser: "alice",
        home: "/home/alice",
        codexHome: "/srv/alice/.codex",
        cwd: "/srv/alice/project",
        role: "admin",
      },
      source: "web-auth.session",
    });
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("token");
  });
});
