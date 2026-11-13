import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

const { nextResponseNext, mockApiResponse } = vi.hoisted(() => ({
  nextResponseNext: vi.fn(() => ({ kind: "next" })),
  mockApiResponse: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: nextResponseNext,
  },
}));

vi.mock("@/frontend-preview/mock-api", () => ({
  mockApiResponse,
}));

import { isPublicWebAuthPath, proxy } from "../../proxy";
import { createSessionToken, readWebAuthConfig, WEB_AUTH_COOKIE } from "../../../server/web-auth";

function makeRequest(pathname: string) {
  const token = createSessionToken(readWebAuthConfig(process.env));
  return {
    url: `http://localhost:3000${pathname}`,
    headers: new Headers({ cookie: `${WEB_AUTH_COOKIE}=${token}` }),
    nextUrl: { pathname, search: "" },
  } as unknown as Parameters<typeof proxy>[0];
}

beforeEach(() => {
  vi.stubEnv("CODEX_WEB_AUTH_MODE", "local");
  vi.stubEnv("CODEX_WEB_LOGIN_EMAIL", "test@admin.com");
  vi.stubEnv("CODEX_WEB_LOGIN_PASSWORD", "123456");
  vi.stubEnv("CODEX_WEB_SESSION_SECRET", "0123456789abcdef0123456789abcdef");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("proxy demo gate", () => {
  it("公开站点图标资源，避免未登录时被重定向", () => {
    expect(isPublicWebAuthPath("/icon.svg")).toBe(true);
  });

  it("默认走真实路由，不启用 demo/mock", async () => {
    const response = await proxy(makeRequest("/api/codex/account"));
    expect(mockApiResponse).not.toHaveBeenCalled();
    expect(nextResponseNext).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ kind: "next" });
  });

  it("显式 CODEX_WEB_DEMO=1 时才走 mock", async () => {
    process.env.CODEX_WEB_DEMO = "1";
    mockApiResponse.mockReturnValue({ kind: "mock" });

    const response = await proxy(makeRequest("/api/codex/account"));

    expect(mockApiResponse).toHaveBeenCalledTimes(1);
    expect(nextResponseNext).not.toHaveBeenCalled();
    expect(response).toEqual({ kind: "mock" });
  });

  it("bridge-url 始终放行真实路由", async () => {
    process.env.CODEX_WEB_DEMO = "1";

    const response = await proxy(makeRequest("/api/codex/bridge-url"));

    expect(mockApiResponse).not.toHaveBeenCalled();
    expect(nextResponseNext).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ kind: "next" });
  });

  it("/v1alpha 不经过 Cookie 门禁或 demo mock", async () => {
    process.env.CODEX_WEB_DEMO = "1";
    mockApiResponse.mockReturnValue({ kind: "mock" });

    const response = await proxy({
      url: "http://localhost:3000/v1alpha/sources",
      headers: new Headers(),
      nextUrl: { pathname: "/v1alpha/sources", search: "" },
    } as unknown as Parameters<typeof proxy>[0]);

    expect(mockApiResponse).not.toHaveBeenCalled();
    expect(nextResponseNext).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ kind: "next" });
  });
});
